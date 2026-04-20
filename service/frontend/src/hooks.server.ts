import type { Handle } from '@sveltejs/kit';
import { resolveSession } from '$server/auth';
import { ensureDatabaseSchema } from '$server/schema';
import { ensureStorageBucket } from '$server/storage';

let schemaReady = false;
let storageReady = false;

export const handle: Handle = async ({ event, resolve }) => {
  if (!schemaReady) {
    await ensureDatabaseSchema();
    schemaReady = true;
  }
  if (!storageReady) {
    await ensureStorageBucket().catch(() => undefined);
    storageReady = true;
  }
  await resolveSession(event);
  return resolve(event);
};
