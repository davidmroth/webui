import { json } from '@sveltejs/kit';
import { requireSession } from '$server/auth';
import { enqueueBriefingRerender } from '$server/briefing-render-jobs';

export async function POST(event) {
	const session = await requireSession(event);
	const queued = await enqueueBriefingRerender(event.params.jobId, session.userId);
	if (!queued) {
		return json({ error: 'Unable to queue a rerender for this briefing.' }, { status: 409 });
	}

	return json({ ok: true, ...queued }, { status: 202 });
}