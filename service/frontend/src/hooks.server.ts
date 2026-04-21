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

  const response = await resolve(event);

  // Keep service-worker update files revalidating on every navigation.
  // Without this, intermediary/proxy caches can delay PWA upgrades.
  if (
    event.request.method === 'GET' &&
    (event.url.pathname === '/sw.js' ||
      event.url.pathname === '/registerSW.js' ||
      event.url.pathname === '/manifest.webmanifest' ||
      event.url.pathname === '/sw-notifications.js')
  ) {
    response.headers.set('cache-control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    response.headers.set('pragma', 'no-cache');
    response.headers.set('expires', '0');
  }

  return response;
};
