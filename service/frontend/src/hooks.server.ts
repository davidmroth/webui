import type { Handle } from '@sveltejs/kit';
import { resolveSession } from '$server/auth';
import { startDiagnosticsMonitor } from '$server/diagnostics-monitor';
import { ensureDatabaseSchema } from '$server/schema';
import { ensureStorageBucket } from '$server/storage';

let schemaReady = false;
let storageReady = false;

export const handle: Handle = async ({ event, resolve }) => {
  startDiagnosticsMonitor();

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

  // Briefing routes use ssr=false, so the list/player load as __data.json.
  // Installed PWAs otherwise HTTP-cache those snapshots and never show newly
  // added briefings until the cache entry expires.
  if (
    event.request.method === 'GET' &&
    event.url.pathname.includes('/briefings') &&
    event.url.pathname.endsWith('/__data.json')
  ) {
    response.headers.set('cache-control', 'no-store');
  }

  return response;
};
