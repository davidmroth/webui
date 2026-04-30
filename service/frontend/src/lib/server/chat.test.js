import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveAssistantParentMessageId,
  shouldAdvanceAssistantTail,
  updateAssistantMessage
} from './chat.ts';

function createConversationState(currNode) {
  return {
    id: 'conv-1',
    created_at: '2026-04-27T00:00:00.000Z',
    curr_node: currNode,
    title: 'Alpha'
  };
}

test('shouldAdvanceAssistantTail keeps substantive assistant replies as the active tail', () => {
  assert.equal(
    shouldAdvanceAssistantTail({ role: 'assistant', content: 'Here is the final answer.' }),
    true
  );
});

test('shouldAdvanceAssistantTail ignores Hermes status messages', () => {
  assert.equal(
    shouldAdvanceAssistantTail({ role: 'assistant', content: "💾 Skill 'deep-research' updated." }),
    false
  );
  assert.equal(
    shouldAdvanceAssistantTail({ role: 'system', content: 'Here is the final answer.' }),
    false
  );
  assert.equal(
    shouldAdvanceAssistantTail({
      role: 'assistant',
      displayType: 'tool_progress',
      content: 'search_web: Iran military history'
    }),
    false
  );
});

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

      if (sql.includes('FROM messages') && sql.includes('ORDER BY msg_timestamp ASC')) {
        return [];
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
    ensureConversationRootMessageFn: async () => 'root-1'
  });

  assert.equal(parentId, 'user-4');
});

test('resolveAssistantParentMessageId appends active Hermes output to the current turn leaf', async () => {
  const parentId = await resolveAssistantParentMessageId('conv-1', null, {
    getConversationStateFn: async () => createConversationState('assistant-progress-1'),
    queryFn: async (sql, params = {}) => {
      if (sql.includes("AND role = 'user'") && params.id === 'assistant-progress-1') {
        return [];
      }

      if (sql.includes('FROM hermes_events')) {
        return [{ message_id: 'user-1' }];
      }

      if (sql.includes('FROM messages') && sql.includes('ORDER BY msg_timestamp ASC')) {
        return [
          {
            id: 'root-1',
            parent_id: null,
            role: 'system',
            content: '',
            created_at: '2026-04-27T00:00:00.000Z',
            updated_at: '2026-04-27T00:00:00.000Z',
            status: 'complete',
            type: 'root',
            msg_timestamp: 0
          },
          {
            id: 'user-1',
            parent_id: 'root-1',
            role: 'user',
            content: 'Yes',
            created_at: '2026-04-27T00:00:01.000Z',
            updated_at: '2026-04-27T00:00:01.000Z',
            status: 'complete',
            type: 'text',
            msg_timestamp: 1
          },
          {
            id: 'assistant-progress-1',
            parent_id: 'user-1',
            role: 'assistant',
            content: 'I can see the repo.',
            created_at: '2026-04-27T00:00:02.000Z',
            updated_at: '2026-04-27T00:00:02.000Z',
            status: 'complete',
            type: 'text',
            msg_timestamp: 2
          }
        ];
      }

      throw new Error(`Unexpected query: ${sql} ${JSON.stringify(params)}`);
    },
    ensureConversationRootMessageFn: async () => 'root-1'
  });

  assert.equal(parentId, 'assistant-progress-1');
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
            if (sql.includes('FROM messages') && sql.includes('ORDER BY messages.msg_timestamp ASC')) {
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

test('updateAssistantMessage updates active tool progress without moving the conversation tail', async () => {
  const executeCalls = [];
  const stateUpdates = [];
  const streamEvents = [];
  const notifications = [];

  await updateAssistantMessage(
    'conv-1',
    'progress-1',
    'search_web: "one"\nexecute_code: "two"',
    {},
    {
      getConversationStateFn: async () => createConversationState('assistant-1'),
      queryFn: async (sql, params = {}) => {
        if (sql.includes('FROM messages') && sql.includes('ORDER BY messages.msg_timestamp ASC')) {
          return [
            {
              id: 'root-1',
              parent_id: null,
              role: 'system',
              content: '',
              created_at: '2026-04-27T00:00:00.000Z',
              updated_at: '2026-04-27T00:00:00.000Z',
              status: 'complete',
              type: 'root',
              source: 'hermes',
              msg_timestamp: 0
            },
            {
              id: 'user-1',
              parent_id: 'root-1',
              role: 'user',
              content: 'Do work',
              created_at: '2026-04-27T00:00:01.000Z',
              updated_at: '2026-04-27T00:00:01.000Z',
              status: 'complete',
              type: 'text',
              source: 'browser',
              msg_timestamp: 1
            },
            {
              id: 'progress-1',
              parent_id: 'user-1',
              role: 'system',
              content: 'search_web: "one"',
              created_at: '2026-04-27T00:00:02.000Z',
              updated_at: '2026-04-27T00:00:02.000Z',
              status: 'complete',
              type: 'text',
              source: 'hermes',
              extra: JSON.stringify({ displayType: 'tool_progress' }),
              msg_timestamp: 2
            },
            {
              id: 'assistant-1',
              parent_id: 'progress-1',
              role: 'assistant',
              content: 'Done',
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
  assert.doesNotMatch(executeCalls[0].sql, /timings = :timings/);
  assert.deepEqual(stateUpdates, []);
  assert.deepEqual(streamEvents, [
    {
      type: 'done',
      conversationId: 'conv-1',
      messageId: 'progress-1',
      status: 'complete'
    }
  ]);
  assert.deepEqual(notifications, []);
});

test('updateAssistantMessage rejects off-branch tool progress updates', async () => {
  const executeCalls = [];

  await assert.rejects(
    () =>
      updateAssistantMessage(
        'conv-1',
        'progress-1',
        'execute_code: "two"',
        {},
        {
          getConversationStateFn: async () => createConversationState('assistant-2'),
          queryFn: async (sql, params = {}) => {
            if (sql.includes('FROM messages') && sql.includes('ORDER BY messages.msg_timestamp ASC')) {
              return [
                {
                  id: 'root-1',
                  parent_id: null,
                  role: 'system',
                  content: '',
                  created_at: '2026-04-27T00:00:00.000Z',
                  updated_at: '2026-04-27T00:00:00.000Z',
                  status: 'complete',
                  type: 'root',
                  source: 'hermes',
                  msg_timestamp: 0
                },
                {
                  id: 'user-1',
                  parent_id: 'root-1',
                  role: 'user',
                  content: 'Old work',
                  created_at: '2026-04-27T00:00:01.000Z',
                  updated_at: '2026-04-27T00:00:01.000Z',
                  status: 'complete',
                  type: 'text',
                  source: 'browser',
                  msg_timestamp: 1
                },
                {
                  id: 'progress-1',
                  parent_id: 'user-1',
                  role: 'system',
                  content: 'search_web: "one"',
                  created_at: '2026-04-27T00:00:02.000Z',
                  updated_at: '2026-04-27T00:00:02.000Z',
                  status: 'complete',
                  type: 'text',
                  source: 'hermes',
                  extra: { displayType: 'tool_progress' },
                  msg_timestamp: 2
                },
                {
                  id: 'user-2',
                  parent_id: 'root-1',
                  role: 'user',
                  content: 'New work',
                  created_at: '2026-04-27T00:00:03.000Z',
                  updated_at: '2026-04-27T00:00:03.000Z',
                  status: 'complete',
                  type: 'text',
                  source: 'browser',
                  msg_timestamp: 3
                },
                {
                  id: 'assistant-2',
                  parent_id: 'user-2',
                  role: 'assistant',
                  content: 'Done',
                  created_at: '2026-04-27T00:00:04.000Z',
                  updated_at: '2026-04-27T00:00:04.000Z',
                  status: 'complete',
                  type: 'text',
                  source: 'hermes',
                  msg_timestamp: 4
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
        if (sql.includes('FROM messages') && sql.includes('ORDER BY messages.msg_timestamp ASC')) {
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
