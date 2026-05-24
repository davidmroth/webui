import { json } from '@sveltejs/kit';
import { claimNextBriefingRenderJob } from '$server/briefing-render-jobs';
import { derivePublicBaseUrl } from '$server/public-base-url';
import { isAuthorizedInternalService, unauthorizedInternalServiceResponse } from '$server/internal-service-auth';

export async function GET({ request }) {
	if (!isAuthorizedInternalService(request)) {
		return unauthorizedInternalServiceResponse();
	}

	const claimed = await claimNextBriefingRenderJob();
	if (!claimed) {
		return new Response(null, { status: 204 });
	}

	const baseUrl = derivePublicBaseUrl(request, request.url ? new URL(request.url).origin : '');
	return json({
		...claimed,
		callbacks: {
			progressUrl: `${baseUrl}${claimed.callbacks.progressPath}`,
			completeUrl: `${baseUrl}${claimed.callbacks.completePath}`,
			failUrl: `${baseUrl}${claimed.callbacks.failPath}`
		}
	});
}