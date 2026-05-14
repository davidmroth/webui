import { json } from '@sveltejs/kit';
import { requireSession } from '$server/auth';
import { setBriefingPublicState } from '$server/briefing-sharing';

export async function POST(event) {
	const session = await requireSession(event);
	const body = await event.request.json().catch(() => ({}));
	const isPublic = body?.isPublic === true;

	try {
		const sharing = await setBriefingPublicState(event.params.jobId, session.userId, isPublic);
		return json({
			isPublic: sharing.isPublic,
			playerPath: `/briefings/${encodeURIComponent(sharing.jobId)}/player`,
			standalonePath: `/briefings/${encodeURIComponent(sharing.jobId)}`
		});
	} catch (routeError) {
		if (routeError instanceof Error && routeError.message.includes('Only the briefing owner')) {
			return json({ error: 'Not found.' }, { status: 404 });
		}

		return json({ error: 'Unable to update briefing sharing.' }, { status: 500 });
	}
}