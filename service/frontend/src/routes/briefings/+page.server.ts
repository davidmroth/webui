import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireSession } from '$server/auth';
import { deleteBriefingForUser, listBriefingsForUser } from '$server/briefing-list';

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

export const actions: Actions = {
  delete: async (event) => {
    const session = await requireSession(event);
    const formData = await event.request.formData();
    const jobId = String(formData.get('jobId') || '').trim();

    if (!jobId) {
      return fail(400, { error: 'A briefing job id is required.' });
    }

    try {
      await deleteBriefingForUser(session.userId, jobId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to delete the briefing.';
      const status = /owner|verified/i.test(message) ? 403 : 500;
      return fail(status, { error: message });
    }

    return {
      deletedJobId: jobId
    };
  }
};