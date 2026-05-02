import test from 'node:test';
import assert from 'node:assert/strict';
import {
  publishConversationStreamEvent,
  subscribeConversationStream
} from './conversation-stream.ts';

test('conversation stream delivers Hermes typing lifecycle events without message ids', () => {
  const received = [];
  const unsubscribe = subscribeConversationStream('conv-typing', (event) => {
    received.push(event);
  });

  publishConversationStreamEvent({
    type: 'typing',
    conversationId: 'conv-typing'
  });
  publishConversationStreamEvent({
    type: 'typing-stop',
    conversationId: 'conv-typing'
  });

  unsubscribe();

  assert.deepEqual(received, [
    {
      type: 'typing',
      conversationId: 'conv-typing'
    },
    {
      type: 'typing-stop',
      conversationId: 'conv-typing'
    }
  ]);
});

test('conversation stream typing events stay scoped to their conversation', () => {
  const received = [];
  const unsubscribe = subscribeConversationStream('conv-visible', (event) => {
    received.push(event);
  });

  publishConversationStreamEvent({
    type: 'typing',
    conversationId: 'conv-other'
  });

  unsubscribe();

  assert.deepEqual(received, []);
});

test('conversation stream delivers durable run status events', () => {
  const received = [];
  const unsubscribe = subscribeConversationStream('conv-status', (event) => {
    received.push(event);
  });

  publishConversationStreamEvent({
    type: 'status',
    conversationId: 'conv-status',
    messageId: 'message-1',
    eventId: 'event-1',
    runStatus: 'processing'
  });

  unsubscribe();

  assert.deepEqual(received, [
    {
      type: 'status',
      conversationId: 'conv-status',
      messageId: 'message-1',
      eventId: 'event-1',
      runStatus: 'processing'
    }
  ]);
});
