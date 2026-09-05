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
  event.depends('briefings:archive');
  const session = await requireSession(event);
  // The archive list is fetched client-side (ssr=false) as __data.json. Without
  // this, that response carries no Cache-Control and an installed PWA serves a
  // stale list from its HTTP cache. Match the no-store hygiene of the /api routes.
  event.setHeaders({ 'cache-control': 'no-store' });
  // Sync from object storage so briefings created by Hermes/cron show up
  // without requiring a direct /briefings/{jobId} visit to heal the catalog.
  const briefings = await listBriefingsForUser(session.userId, {
    page: parsePageParam(event.url.searchParams.get('page')),
    syncFromStorage: true,
    defaultOwnerUserId: session.userId
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