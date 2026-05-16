import type { PageServerLoad } from './$types';
import { requireSession } from '$server/auth';
import { listBriefingsForUser } from '$server/briefing-list';

function parsePageParam(raw: string | null) {
  const parsed = Number(raw ?? '1');
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }

  return Math.floor(parsed);
}

export const load: PageServerLoad = async (event) => {
  const session = await requireSession(event);
  const briefings = await listBriefingsForUser(session.userId, {
    page: parsePageParam(event.url.searchParams.get('page'))
  });

  return {
    briefings
  };
};