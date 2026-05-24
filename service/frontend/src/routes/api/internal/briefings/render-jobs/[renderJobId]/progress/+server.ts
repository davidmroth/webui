import { json } from '@sveltejs/kit';
import { markBriefingRenderJobProgress } from '$server/briefing-render-jobs';
import { isAuthorizedInternalService, unauthorizedInternalServiceResponse } from '$server/internal-service-auth';

export async function POST({ params, request }) {
	if (!isAuthorizedInternalService(request)) {
		return unauthorizedInternalServiceResponse();
	}

	const body = await request.json().catch(() => null);
	const stage = typeof body?.stage === 'string' ? body.stage : '';
	if (!stage) {
		return json({ error: 'stage is required.' }, { status: 400 });
	}

	const updated = await markBriefingRenderJobProgress(params.renderJobId, stage, {
		percent: typeof body?.percent === 'number' ? body.percent : null,
		detail: typeof body?.detail === 'string' ? body.detail : null,
		sentenceTotal: typeof body?.sentenceTotal === 'number' ? body.sentenceTotal : null,
		sentenceCompleted: typeof body?.sentenceCompleted === 'number' ? body.sentenceCompleted : null
	});
	if (!updated) {
		return json({ error: 'Render job not found.' }, { status: 404 });
	}

	return json(updated);
}