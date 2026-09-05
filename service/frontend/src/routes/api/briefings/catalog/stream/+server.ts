import { requireSession } from '$server/auth';
import { subscribeBriefingCatalog } from '$server/briefing-catalog-stream';

const HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_STREAM_DURATION_MS = 5 * 60_000;

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(event) {
  const session = await requireSession(event);
  const encoder = new TextEncoder();
  let cancelled = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribe = () => {};

  const stream = new ReadableStream({
    start(controller) {
      const close = () => {
        if (cancelled) {
          return;
        }
        cancelled = true;
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
        }
        if (closeTimer) {
          clearTimeout(closeTimer);
        }
        unsubscribe();
        try {
          controller.close();
        } catch {}
      };

      const send = (payload: string) => {
        if (cancelled) {
          return;
        }
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          close();
        }
      };

      send(sse('open', {}));
      unsubscribe = subscribeBriefingCatalog(session.userId, (catalogEvent) => {
        send(sse('briefing', { jobId: catalogEvent.jobId }));
      });
      heartbeatTimer = setInterval(() => send(': keepalive\n\n'), HEARTBEAT_INTERVAL_MS);
      closeTimer = setTimeout(close, MAX_STREAM_DURATION_MS);
      event.request.signal.addEventListener('abort', close, { once: true });
    }
  });

  return new Response(stream, {
    headers: {
      'cache-control': 'no-store',
      'content-type': 'text/event-stream; charset=utf-8',
      connection: 'keep-alive',
      'x-accel-buffering': 'no'
    }
  });
}
