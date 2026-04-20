import { json } from '@sveltejs/kit';
import { getConfig } from '$server/env';
import { getHermesQueueStats } from '$server/chat';
import {
  getHermesWorkerHeartbeat,
  noteHermesWorkerAuthFailure,
  noteHermesWorkerHeartbeat
} from '$server/hermes-heartbeat';

function isAuthorized(request: Request) {
  const expected = getConfig().hermesServiceToken;
  const authHeader = request.headers.get('authorization') || '';
  return authHeader === `Bearer ${expected}`;
}

export async function GET({ request }) {
  if (!isAuthorized(request)) {
    noteHermesWorkerAuthFailure('health');
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  noteHermesWorkerHeartbeat('health');

  const queue = await getHermesQueueStats();
  const worker = getHermesWorkerHeartbeat();
  return json({ ok: true, service: 'hermes-webui', queue, worker });
}
