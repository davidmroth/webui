import { json } from '@sveltejs/kit';
import { requireSession } from '$server/auth';
import { loadBriefingPreview } from '$server/briefings';
import type { BriefingPreview } from '$lib/types/briefing';

function statusCodeForState(state: BriefingPreview['state']) {
	switch (state) {
		case 'ready':
			return 200;
		case 'processing':
			return 202;
		case 'failed':
			return 409;
		case 'missing':
			return 404;
		default:
			return 502;
	}
}

export async function GET(event) {
	await requireSession(event);
	const preview = await loadBriefingPreview(event.params.jobId);
	return json(preview, { status: statusCodeForState(preview.state) });
}
