import type { PageServerLoad } from './$types';
import { requireSession } from '$server/auth';
import { loadBriefingPreview } from '$server/briefings';
import { getBriefingViewerAccess } from '$server/briefing-sharing';
import { lookupBriefingConversationId } from '$server/chat';

export const load: PageServerLoad = async (event) => {
	const session = await requireSession(event);
	const access = await getBriefingViewerAccess(event.params.jobId, session.userId);

	const preview = await loadBriefingPreview(event.params.jobId);
	const conversationId = await lookupBriefingConversationId(session.userId, preview.jobId);
	const returnToChatHref = conversationId
		? `/chat?conversation=${encodeURIComponent(conversationId)}`
		: '/chat';

	return {
		preview,
		sharing: {
			isPublic: access.isPublic,
			canManage: access.canManage,
			playerPath: `/briefings/${encodeURIComponent(event.params.jobId)}/player`,
			standalonePath: `/briefings/${encodeURIComponent(event.params.jobId)}`,
			returnToChatHref
		}
	};
};