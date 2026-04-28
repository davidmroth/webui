import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveAssistantParentMessageId } from './chat.ts';

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
