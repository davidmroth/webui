import { json } from '@sveltejs/kit';
import { completeBriefingRenderJob } from '$server/briefing-render-jobs';
import { isAuthorizedInternalService, unauthorizedInternalServiceResponse } from '$server/internal-service-auth';

export async function POST({ params, request }) {
	if (!isAuthorizedInternalService(request)) {
		return unauthorizedInternalServiceResponse();
	}

	const body = await request.json().catch(() => ({}));
	const completed = await completeBriefingRenderJob(params.renderJobId, {
		audioAsset: body?.audioAsset,
		validation: body?.validation,
		completedAt: typeof body?.completedAt === 'string' ? body.completedAt : null
	});
	if (!completed) {
		return json({ error: 'Render job not found.' }, { status: 404 });
	}

	return json(completed);
}