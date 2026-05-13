import type { PageServerLoad } from './$types';
import { requireSession } from '$server/auth';
import { loadBriefingPreview } from '$server/briefings';

export const load: PageServerLoad = async (event) => {
	await requireSession(event);
	const preview = await loadBriefingPreview(event.params.jobId);

	return {
		preview
	};
};