import { json } from '@sveltejs/kit';
import { failBriefingRenderJob } from '$server/briefing-render-jobs';
import { isAuthorizedInternalService, unauthorizedInternalServiceResponse } from '$server/internal-service-auth';

export async function POST({ params, request }) {
	if (!isAuthorizedInternalService(request)) {
		return unauthorizedInternalServiceResponse();
	}

	const body = await request.json().catch(() => null);
	const errorMessage = typeof body?.error === 'string' ? body.error : '';
	if (!errorMessage.trim()) {
		return json({ error: 'error is required.' }, { status: 400 });
	}

	const failed = await failBriefingRenderJob(params.renderJobId, errorMessage);
	if (!failed) {
		return json({ error: 'Render job not found.' }, { status: 404 });
	}

	return json(failed);
}