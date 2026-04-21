import { error } from '@sveltejs/kit';
import { requireSession } from '$server/auth';
import {
  findLatestAssistantMessage,
  findActiveAssistantMessage,
  getMessageStatus,
  listAssistantChunks
} from '$server/chat';

const POLL_INTERVAL_MS = 200;
const HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_STREAM_DURATION_MS = 5 * 60_000;

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(event) {
  const session = await requireSession(event);
  const { conversationId } = event.params;
  if (!conversationId) {
    throw error(400, 'conversationId required');
  }

  const encoder = new TextEncoder();
  let cancelled = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

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
      heartbeatTimer = setInterval(() => send(': keepalive\n\n'), HEARTBEAT_INTERVAL_MS);

      const startedAt = Date.now();
      let lastSeq = -1;
      let activeMessageId: string | null = null;
      let latestAssistantId = (await findLatestAssistantMessage(session.userId, conversationId))?.id ?? null;

      // Wait briefly for an active streaming message to appear.
      while (!cancelled && Date.now() - startedAt < MAX_STREAM_DURATION_MS) {
        if (!activeMessageId) {
          activeMessageId = await findActiveAssistantMessage(session.userId, conversationId);
          if (activeMessageId) {
            send(sse('message', { messageId: activeMessageId }));
          }
        }

        if (activeMessageId) {
          const chunks = await listAssistantChunks(activeMessageId, lastSeq);
          for (const chunk of chunks) {
            send(sse('delta', { messageId: activeMessageId, seq: chunk.seq, delta: chunk.delta }));
            if (chunk.seq > lastSeq) lastSeq = chunk.seq;
          }

          const status = await getMessageStatus(activeMessageId);
          if (!status || status.status !== 'streaming') {
            send(sse('done', { messageId: activeMessageId, status: status?.status ?? 'complete' }));
            break;
          }
        } else {
          const latestAssistant = await findLatestAssistantMessage(session.userId, conversationId);
          if (latestAssistant && latestAssistant.id !== latestAssistantId) {
            send(sse('done', { messageId: latestAssistant.id, status: latestAssistant.status }));
            break;
          }
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }

      if (heartbeatTimer) clearInterval(heartbeatTimer);
      try {
        controller.close();
      } catch {
        // already closed
      }
    },
    cancel() {
      cancelled = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
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
