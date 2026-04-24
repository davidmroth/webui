import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getAssistantCatchupDoneEvent,
  resolveConversationStreamCursor
} from './conversation-stream-recovery.ts';

test('resolveConversationStreamCursor prefers the EventSource reconnect cursor', () => {
  assert.equal(
    resolveConversationStreamCursor({
      lastEventId: 'assistant-2',
      lastAssistantMessageId: 'assistant-1'
    }),
    'assistant-2'
  );
});

test('resolveConversationStreamCursor falls back to the initial assistant cursor', () => {
  assert.equal(
    resolveConversationStreamCursor({
      lastEventId: '   ',
      lastAssistantMessageId: 'assistant-1'
    }),
    'assistant-1'
  );
});

test('getAssistantCatchupDoneEvent emits a catch-up for a newer completed assistant reply', () => {
  assert.deepEqual(
    getAssistantCatchupDoneEvent(
      { id: 'assistant-2', status: 'complete' },
      'assistant-1'
    ),
    { messageId: 'assistant-2', status: 'complete' }
  );
});

test('getAssistantCatchupDoneEvent suppresses duplicates for the latest delivered reply', () => {
  assert.equal(
    getAssistantCatchupDoneEvent(
      { id: 'assistant-2', status: 'complete' },
      'assistant-2'
    ),
    null
  );
});

test('getAssistantCatchupDoneEvent ignores in-flight assistant replies', () => {
  assert.equal(
    getAssistantCatchupDoneEvent(
      { id: 'assistant-2', status: 'streaming' },
      'assistant-1'
    ),
    null
  );
});