import { error } from '@sveltejs/kit';
import { requireSession } from '$server/auth';
import {
  findActiveAssistantMessage,
  findLatestAssistantMessage,
  getConversationRunState,
  getMessageStatus,
  listAssistantChunks
} from '$server/chat';
import {
  getAssistantCatchupDoneEvent,
  resolveConversationStreamCursor
} from '$server/conversation-stream-recovery';
import {
  subscribeConversationStream,
  type ConversationStreamEvent
} from '$server/conversation-stream';
import { DiagnosticEventType, DiagnosticHop, emitDiagnosticEvent } from '$server/diagnostics';

const HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_STREAM_DURATION_MS = 5 * 60_000;

function sse(event: string, data: unknown, options: { id?: string } = {}): string {
  const eventId = options.id?.trim();
  const idLine = eventId ? `id: ${eventId}\n` : '';
  return `${idLine}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(event) {
  const session = await requireSession(event);
  const { conversationId } = event.params;
  if (!conversationId) {
    throw error(400, 'conversationId required');
  }

  const streamCursor = resolveConversationStreamCursor({
    lastEventId: event.request.headers.get('last-event-id'),
    lastAssistantMessageId: event.url.searchParams.get('lastAssistantMessageId')
  });

  const encoder = new TextEncoder();
  let cancelled = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  const abortController = new AbortController();
  const connectionId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const startedAt = Date.now();
  let disconnectEmitted = false;

  const emitDisconnect = (reason: string) => {
    if (disconnectEmitted) {
      return;
    }
    disconnectEmitted = true;
    emitDiagnosticEvent(
      DiagnosticEventType.SseClientDisconnected,
      DiagnosticHop.SseStream,
      {
        conversationId,
        connectionId,
        reason,
        durationMs: Date.now() - startedAt
      },
      conversationId
    );
  };

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: string) => {
        if (cancelled) return;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          cancelled = true;
        }
      };

      send(sse('open', { conversationId }));
      emitDiagnosticEvent(
        DiagnosticEventType.SseClientConnected,
        DiagnosticHop.SseStream,
        { conversationId, connectionId },
        conversationId
      );
      heartbeatTimer = setInterval(() => send(': keepalive\n\n'), HEARTBEAT_INTERVAL_MS);

      const initialRunState = await getConversationRunState(session.userId, conversationId);
      if (initialRunState.status !== 'idle' && initialRunState.messageId) {
        send(
          sse('status', {
            messageId: initialRunState.messageId,
            runStatus: initialRunState.status,
            eventId: initialRunState.eventId ?? null,
            errorCode: initialRunState.errorCode ?? null,
            errorMessage: initialRunState.errorMessage ?? null
          })
        );
      }

      let lastSeq = -1;
      let activeMessageId: string | null = null;
      const queuedEvents: ConversationStreamEvent[] = [];
      let resolveNextEvent: ((streamEvent: ConversationStreamEvent | null) => void) | null = null;
      const unsubscribe = subscribeConversationStream(conversationId, (streamEvent) => {
        if (cancelled) {
          return;
        }

        if (resolveNextEvent) {
          const resolve = resolveNextEvent;
          resolveNextEvent = null;
          resolve(streamEvent);
          return;
        }

        queuedEvents.push(streamEvent);
      });

      const waitForNextEvent = (timeoutMs: number) =>
        new Promise<ConversationStreamEvent | null>((resolve) => {
          if (queuedEvents.length > 0) {
            resolve(queuedEvents.shift() ?? null);
            return;
          }

          const handleAbort = () => {
            cleanup();
            resolve(null);
          };
          const timer = setTimeout(() => {
            cleanup();
            resolve(null);
          }, timeoutMs);
          const wrappedResolve = (streamEvent: ConversationStreamEvent | null) => {
            cleanup();
            resolve(streamEvent);
          };
          const cleanup = () => {
            clearTimeout(timer);
            abortController.signal.removeEventListener('abort', handleAbort);
            if (resolveNextEvent === wrappedResolve) {
              resolveNextEvent = null;
            }
          };

          resolveNextEvent = wrappedResolve;
          abortController.signal.addEventListener('abort', handleAbort, { once: true });
        });

      const flushChunks = async (messageId: string) => {
        const chunks = await listAssistantChunks(messageId, lastSeq);
        for (const chunk of chunks) {
          if (chunk.seq <= lastSeq) {
            continue;
          }

          send(sse('delta', { messageId, seq: chunk.seq, delta: chunk.delta }));
          lastSeq = chunk.seq;
        }
      };

      try {
        activeMessageId = await findActiveAssistantMessage(session.userId, conversationId);
        if (activeMessageId) {
          send(sse('message', { messageId: activeMessageId }));
          await flushChunks(activeMessageId);

          const status = await getMessageStatus(activeMessageId);
          if (!status || status.status !== 'streaming') {
            send(
              sse(
                'done',
                { messageId: activeMessageId, status: status?.status ?? 'complete' },
                { id: activeMessageId }
              )
            );
            activeMessageId = null;
            lastSeq = -1;
          }
        }

        if (!activeMessageId) {
          const latestAssistantMessage = await findLatestAssistantMessage(session.userId, conversationId);
          const catchupEvent = getAssistantCatchupDoneEvent(latestAssistantMessage, streamCursor);
          if (catchupEvent) {
            send(
              sse(
                'done',
                {
                  messageId: catchupEvent.messageId,
                  status: catchupEvent.status
                },
                { id: catchupEvent.messageId }
              )
            );
          }
        }

        while (!cancelled && Date.now() - startedAt < MAX_STREAM_DURATION_MS) {
          const remainingMs = MAX_STREAM_DURATION_MS - (Date.now() - startedAt);
          const streamEvent = await waitForNextEvent(remainingMs);
          if (!streamEvent) {
            break;
          }

          if (streamEvent.type === 'typing') {
            send(sse('typing', { conversationId: streamEvent.conversationId }));
            emitDiagnosticEvent(DiagnosticEventType.SseEventSent, DiagnosticHop.SseStream, {
              conversationId,
              connectionId,
              streamEventType: 'typing'
            }, conversationId);
            continue;
          }

          if (streamEvent.type === 'typing-stop') {
            send(sse('typing-stop', { conversationId: streamEvent.conversationId }));
            emitDiagnosticEvent(DiagnosticEventType.SseEventSent, DiagnosticHop.SseStream, {
              conversationId,
              connectionId,
              streamEventType: 'typing-stop'
            }, conversationId);
            continue;
          }

          if (streamEvent.type === 'status') {
            send(
              sse('status', {
                messageId: streamEvent.messageId,
                runStatus: streamEvent.runStatus,
                eventId: streamEvent.eventId ?? null,
                errorCode: streamEvent.errorCode ?? null,
                errorMessage: streamEvent.errorMessage ?? null
              })
            );
            emitDiagnosticEvent(DiagnosticEventType.SseEventSent, DiagnosticHop.SseStream, {
              conversationId,
              connectionId,
              messageId: streamEvent.messageId,
              streamEventType: 'status',
              runStatus: streamEvent.runStatus
            }, conversationId);
            continue;
          }

          if (streamEvent.type === 'message') {
            if (activeMessageId !== streamEvent.messageId) {
              activeMessageId = streamEvent.messageId;
              lastSeq = -1;
              send(sse('message', { messageId: activeMessageId }));
              emitDiagnosticEvent(DiagnosticEventType.SseEventSent, DiagnosticHop.SseStream, {
                conversationId,
                connectionId,
                messageId: activeMessageId,
                streamEventType: 'message'
              }, conversationId);
              await flushChunks(activeMessageId);
            }
            continue;
          }

          if (streamEvent.type === 'delta') {
            if (activeMessageId !== streamEvent.messageId) {
              activeMessageId = streamEvent.messageId;
              lastSeq = -1;
              send(sse('message', { messageId: activeMessageId }));
            }

            if (streamEvent.seq > lastSeq) {
              send(
                sse('delta', {
                  messageId: streamEvent.messageId,
                  seq: streamEvent.seq,
                  delta: streamEvent.delta
                })
              );
              emitDiagnosticEvent(DiagnosticEventType.SseEventSent, DiagnosticHop.SseStream, {
                conversationId,
                connectionId,
                messageId: streamEvent.messageId,
                streamEventType: 'delta',
                seq: streamEvent.seq,
                deltaLength: streamEvent.delta.length
              }, conversationId);
              lastSeq = streamEvent.seq;
            }
            continue;
          }

          if (activeMessageId === streamEvent.messageId) {
            await flushChunks(streamEvent.messageId);
          }

          send(
            sse('done', {
              messageId: streamEvent.messageId,
              status: streamEvent.status
            }, { id: streamEvent.messageId })
          );
          emitDiagnosticEvent(DiagnosticEventType.SseEventSent, DiagnosticHop.SseStream, {
            conversationId,
            connectionId,
            messageId: streamEvent.messageId,
            streamEventType: 'done',
            status: streamEvent.status
          }, conversationId);
          activeMessageId = null;
          lastSeq = -1;
        }
      } finally {
        unsubscribe();
        if (resolveNextEvent) {
          const resolve: (streamEvent: ConversationStreamEvent | null) => void = resolveNextEvent;
          resolveNextEvent = null;
          resolve(null);
        }
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        emitDisconnect(cancelled ? 'cancelled' : 'closed');
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      cancelled = true;
      abortController.abort();
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      emitDisconnect('cancelled');
    }
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no'
    }
  });
}
