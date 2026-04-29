import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DiagnosticEventType,
  DiagnosticHop,
  emitDiagnosticEvent,
  getDiagnosticEvents,
  getDiagnosticsSnapshot,
  resetDiagnosticsForTests
} from './diagnostics.ts';

test('diagnostics ring buffer remains bounded and newest-first queries work', () => {
  process.env.DIAGNOSTICS_RING_BUFFER_SIZE = '100';
  resetDiagnosticsForTests();

  for (let index = 0; index < 105; index += 1) {
    emitDiagnosticEvent(DiagnosticEventType.SseEventSent, DiagnosticHop.SseStream, {
      conversationId: 'conv-ring',
      messageId: `message-${index}`
    });
  }

  const snapshot = getDiagnosticsSnapshot();
  assert.equal(snapshot.ringBuffer.size, 100);
  assert.equal(snapshot.ringBuffer.capacity, 100);

  const events = getDiagnosticEvents({ limit: 200 });
  assert.equal(events.length, 100);
  assert.equal(events[0].messageId, 'message-104');
  assert.equal(events.at(-1).messageId, 'message-5');
});

test('diagnostics events can be filtered by production correlation ids', () => {
  process.env.DIAGNOSTICS_RING_BUFFER_SIZE = '1000';
  resetDiagnosticsForTests();

  emitDiagnosticEvent(DiagnosticEventType.HermesAssistantUpdateFailed, DiagnosticHop.WebuiApi, {
    conversationId: 'conv-prod',
    messageId: 'msg-prod',
    requestId: 'req-prod',
    senderTraceId: 'trace-prod',
    errorMessage: 'Assistant message not found for update: msg-prod'
  }, 'conv-prod');
  emitDiagnosticEvent(DiagnosticEventType.HermesAssistantPostAccepted, DiagnosticHop.WebuiApi, {
    conversationId: 'conv-other',
    messageId: 'msg-other',
    requestId: 'req-other',
    senderTraceId: 'trace-other'
  }, 'conv-other');

  assert.equal(getDiagnosticEvents({ conversationId: 'conv-prod' }).length, 1);
  assert.equal(getDiagnosticEvents({ messageId: 'msg-prod' }).length, 1);
  assert.equal(getDiagnosticEvents({ requestId: 'req-prod' }).length, 1);
  assert.equal(getDiagnosticEvents({ senderTraceId: 'trace-prod' }).length, 1);
  assert.equal(getDiagnosticEvents({ senderTraceId: 'trace-prod' })[0].details.errorMessage, 'Assistant message not found for update: msg-prod');
});

test('diagnostics tracks pending queue events through dequeue and ack', () => {
  resetDiagnosticsForTests();

  emitDiagnosticEvent(DiagnosticEventType.ClientMessageQueued, DiagnosticHop.HermesQueue, {
    conversationId: 'conv-queue',
    messageId: 'msg-queue',
    eventId: 'event-queue'
  }, 'conv-queue');

  let snapshot = getDiagnosticsSnapshot();
  assert.equal(snapshot.commands.pendingCount, 1);
  assert.equal(snapshot.commands.pending[0].status, 'queued');

  emitDiagnosticEvent(DiagnosticEventType.HermesEventDequeued, DiagnosticHop.HermesQueue, {
    conversationId: 'conv-queue',
    messageId: 'msg-queue',
    eventId: 'event-queue'
  }, 'conv-queue');

  snapshot = getDiagnosticsSnapshot();
  assert.equal(snapshot.commands.pendingCount, 1);
  assert.equal(snapshot.commands.pending[0].status, 'processing');

  emitDiagnosticEvent(DiagnosticEventType.HermesEventAcked, DiagnosticHop.HermesQueue, {
    eventId: 'event-queue'
  });

  snapshot = getDiagnosticsSnapshot();
  assert.equal(snapshot.commands.pendingCount, 0);
});

test('diagnostics updates SSE hop active connection state', () => {
  resetDiagnosticsForTests();

  emitDiagnosticEvent(DiagnosticEventType.SseClientConnected, DiagnosticHop.SseStream, {
    conversationId: 'conv-sse',
    connectionId: 'conn-sse'
  }, 'conv-sse');

  let snapshot = getDiagnosticsSnapshot();
  assert.equal(snapshot.hops.sse_stream.connected, true);
  assert.equal(snapshot.hops.sse_stream.activeConnections, 1);

  emitDiagnosticEvent(DiagnosticEventType.SseClientDisconnected, DiagnosticHop.SseStream, {
    conversationId: 'conv-sse',
    connectionId: 'conn-sse'
  }, 'conv-sse');

  snapshot = getDiagnosticsSnapshot();
  assert.equal(snapshot.hops.sse_stream.connected, false);
  assert.equal(snapshot.hops.sse_stream.activeConnections, 0);
});