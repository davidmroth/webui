import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveAssistantParentMessageId, updateAssistantMessage } from './chat.ts';

function createConversationState(currNode) {
  return {
    id: 'conv-1',
    created_at: '2026-04-27T00:00:00.000Z',
    curr_node: currNode,
    title: 'Alpha'
  };
}

test('resolveAssistantParentMessageId ignores assistant curr_node and falls back to the latest user', async () => {
  const queryCalls = [];
  const parentId = await resolveAssistantParentMessageId('conv-1', null, {
    getConversationStateFn: async () => createConversationState('assistant-2'),
    queryFn: async (sql, params = {}) => {
      queryCalls.push({ sql, params });

      if (sql.includes("AND role = 'user'") && params.id === 'assistant-2') {
        return [];
      }

      if (sql.includes('FROM hermes_events')) {
        return [];
      }

      if (sql.includes('ORDER BY msg_timestamp DESC')) {
        return [{ id: 'user-2' }];
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
    ensureConversationRootMessageFn: async () => 'root-1'
  });

  assert.equal(parentId, 'user-2');
  assert.equal(
    queryCalls.some(
      ({ sql, params }) => sql.includes("AND role = 'user'") && params.id === 'assistant-2'
    ),
    true
  );
  assert.equal(
    queryCalls.some(({ sql }) => sql.includes('ORDER BY msg_timestamp DESC')),
    true
  );
});

test('resolveAssistantParentMessageId reuses curr_node when it already points to a user message', async () => {
  const parentId = await resolveAssistantParentMessageId('conv-1', null, {
    getConversationStateFn: async () => createConversationState('user-3'),
    queryFn: async (sql, params = {}) => {
      if (sql.includes("AND role = 'user'") && params.id === 'user-3') {
        return [{ id: 'user-3', type: 'text' }];
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
    ensureConversationRootMessageFn: async () => 'root-1'
  });

  assert.equal(parentId, 'user-3');
});

test('resolveAssistantParentMessageId still prefers an explicit user message id', async () => {
  const parentId = await resolveAssistantParentMessageId('conv-1', 'user-4', {
    getConversationStateFn: async () => createConversationState('assistant-2'),
    queryFn: async (sql, params = {}) => {
      if (sql.includes("AND role = 'user'") && params.id === 'user-4') {
        return [{ id: 'user-4' }];
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
    ensureConversationRootMessageFn: async () => 'root-1'
  });

  assert.equal(parentId, 'user-4');
});

test('updateAssistantMessage rejects stale Hermes targets outside the visible tail', async () => {
  const executeCalls = [];

  await assert.rejects(
    () =>
      updateAssistantMessage(
        'conv-1',
        'assistant-1',
        'rewritten',
        {},
        {
          getConversationStateFn: async () => createConversationState('assistant-2'),
          queryFn: async (sql, params = {}) => {
            if (sql.includes("source = 'hermes'")) {
              return [
                {
                  id: 'assistant-1',
                  parent_id: 'user-1',
                  role: 'assistant',
                  content: 'older answer',
                  created_at: '2026-04-27T00:00:01.000Z',
                  updated_at: '2026-04-27T00:00:01.000Z',
                  status: 'complete',
                  type: 'text',
                  source: 'hermes',
                  msg_timestamp: 1
                },
                {
                  id: 'assistant-2',
                  parent_id: 'user-2',
                  role: 'assistant',
                  content: 'latest answer',
                  created_at: '2026-04-27T00:00:03.000Z',
                  updated_at: '2026-04-27T00:00:03.000Z',
                  status: 'complete',
                  type: 'text',
                  source: 'hermes',
                  msg_timestamp: 3
                }
              ];
            }

            throw new Error(`Unexpected query: ${sql} ${JSON.stringify(params)}`);
          },
          executeFn: async (sql, params = {}) => {
            executeCalls.push({ sql, params });
          },
          updateConversationStateFn: async () => {
            throw new Error('updateConversationState should not run for stale targets');
          },
          publishConversationStreamEventFn: () => {
            throw new Error('publishConversationStreamEvent should not run for stale targets');
          },
          notifyAssistantReplyCompletionFn: () => {
            throw new Error('notifyAssistantReplyCompletion should not run for stale targets');
          }
        }
      ),
    /Rejected stale assistant update target/
  );

  assert.equal(executeCalls.length, 0);
});

test('updateAssistantMessage updates the current Hermes tail message', async () => {
  const executeCalls = [];
  const stateUpdates = [];
  const streamEvents = [];
  const notifications = [];

  await updateAssistantMessage(
    'conv-1',
    'assistant-2',
    'final answer',
    { timings: { prompt_n: 2 } },
    {
      getConversationStateFn: async () => createConversationState('assistant-2'),
      queryFn: async (sql, params = {}) => {
        if (sql.includes("source = 'hermes'")) {
          return [
            {
              id: 'assistant-1',
              parent_id: 'user-1',
              role: 'assistant',
              content: 'older answer',
              created_at: '2026-04-27T00:00:01.000Z',
              updated_at: '2026-04-27T00:00:01.000Z',
              status: 'complete',
              type: 'text',
              source: 'hermes',
              msg_timestamp: 1
            },
            {
              id: 'assistant-2',
              parent_id: 'assistant-1',
              role: 'assistant',
              content: 'latest answer',
              created_at: '2026-04-27T00:00:03.000Z',
              updated_at: '2026-04-27T00:00:03.000Z',
              status: 'complete',
              type: 'text',
              source: 'hermes',
              msg_timestamp: 3
            }
          ];
        }

        throw new Error(`Unexpected query: ${sql} ${JSON.stringify(params)}`);
      },
      executeFn: async (sql, params = {}) => {
        executeCalls.push({ sql, params });
      },
      updateConversationStateFn: async (conversationId, options) => {
        stateUpdates.push({ conversationId, options });
      },
      publishConversationStreamEventFn: (event) => {
        streamEvents.push(event);
      },
      notifyAssistantReplyCompletionFn: (event) => {
        notifications.push(event);
      }
    }
  );

  assert.equal(executeCalls.length, 1);
  assert.match(executeCalls[0].sql, /timings = :timings/);
  assert.deepEqual(stateUpdates, [{ conversationId: 'conv-1', options: { currNode: 'assistant-2' } }]);
  assert.deepEqual(streamEvents, [
    {
      type: 'done',
      conversationId: 'conv-1',
      messageId: 'assistant-2',
      status: 'complete'
    }
  ]);
  assert.deepEqual(notifications, [
    {
      conversationId: 'conv-1',
      messageId: 'assistant-2',
      content: 'final answer'
    }
  ]);
});
