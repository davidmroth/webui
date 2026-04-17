import type { Handle } from '@sveltejs/kit';
import { resolveSession } from '$server/auth';
import { ensureStorageBucket } from '$server/storage';

let storageReady = false;

export const handle: Handle = async ({ event, resolve }) => {
  if (!storageReady) {
    await ensureStorageBucket().catch(() => undefined);
    storageReady = true;
  }
  await resolveSession(event);
  return resolve(event);
};
