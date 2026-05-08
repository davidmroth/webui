import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireSession } from '$server/auth';
import { loadBriefingPreview } from '$server/briefings';

export const load: PageServerLoad = async (event) => {
	await requireSession(event);
	const preview = await loadBriefingPreview(event.params.jobId);
	if (preview.state !== 'missing' && preview.state !== 'error' && preview.briefingId) {
		const canonicalPath = `/briefings/${encodeURIComponent(preview.briefingId)}/player`;
		if (event.url.pathname !== canonicalPath) {
			throw redirect(308, canonicalPath);
		}
	}

	return {
		preview
	};
};