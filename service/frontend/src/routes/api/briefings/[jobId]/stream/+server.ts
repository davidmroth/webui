import { error } from '@sveltejs/kit';
import { getBriefingViewerAccess } from '$server/briefing-sharing';
import { loadBriefingPreview } from '$server/briefings';

const HEARTBEAT_INTERVAL_MS = 15_000;
const PREVIEW_CHECK_INTERVAL_MS = 2_000;
const MAX_STREAM_DURATION_MS = 5 * 60_000;

function sse(event: string, data: unknown): string {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(event) {
	const access = await getBriefingViewerAccess(event.params.jobId, event.locals.session?.userId ?? null);
	if (!access.canView) {
		throw error(401, 'Unauthorized');
	}

	const encoder = new TextEncoder();
	let cancelled = false;
	let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	let previewTimer: ReturnType<typeof setInterval> | null = null;
	const abortController = new AbortController();

	const stream = new ReadableStream({
		async start(controller) {
			const close = () => {
				if (cancelled) {
					return;
				}
				cancelled = true;
				if (heartbeatTimer) {
					clearInterval(heartbeatTimer);
				}
				if (previewTimer) {
					clearInterval(previewTimer);
				}
				abortController.abort();
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

			let lastSnapshot = '';
			const publishPreview = async () => {
				const preview = await loadBriefingPreview(event.params.jobId);
				const nextSnapshot = JSON.stringify(preview);
				if (nextSnapshot === lastSnapshot) {
					return;
				}

				lastSnapshot = nextSnapshot;
				send(sse('preview', preview));
				if (preview.state !== 'processing') {
					close();
				}
			};

			await publishPreview();
			if (cancelled) {
				return;
			}

			heartbeatTimer = setInterval(() => send(': keepalive\n\n'), HEARTBEAT_INTERVAL_MS);
			previewTimer = setInterval(() => {
				void publishPreview();
			}, PREVIEW_CHECK_INTERVAL_MS);
			setTimeout(close, MAX_STREAM_DURATION_MS);
			event.request.signal.addEventListener('abort', close, { once: true });
			abortController.signal.addEventListener('abort', close, { once: true });
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