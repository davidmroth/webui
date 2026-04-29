import { json } from '@sveltejs/kit';
import { getDiagnosticsSnapshot } from '$server/diagnostics';
import { requireDiagnosticsToken } from '$server/diagnostics-auth';
import { getHermesQueueStats } from '$server/chat';
import { getHermesWorkerHeartbeat } from '$server/hermes-heartbeat';

export async function GET({ request }) {
  const denied = requireDiagnosticsToken(request);
  if (denied) {
    return denied;
  }

  const [queue, worker] = await Promise.all([
    getHermesQueueStats().catch((error) => ({
      error: error instanceof Error ? error.message : 'Queue query failed.'
    })),
    Promise.resolve(getHermesWorkerHeartbeat())
  ]);

  return json({
    success: true,
    ...getDiagnosticsSnapshot(),
    webui: {
      queue,
      worker
    }
  });
}