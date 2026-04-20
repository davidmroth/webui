import { json } from '@sveltejs/kit';
import { dequeueHermesEvent } from '$server/chat';
import { getConfig } from '$server/env';
import { noteHermesWorkerHeartbeat } from '$server/hermes-heartbeat';

function isAuthorized(request: Request) {
  const expected = getConfig().hermesServiceToken;
  const authHeader = request.headers.get('authorization') || '';
  return authHeader === `Bearer ${expected}`;
}

export async function GET({ request }) {
  if (!isAuthorized(request)) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  noteHermesWorkerHeartbeat('inbox-next');

  const event = await dequeueHermesEvent();
  if (!event) {
    return new Response(null, { status: 204 });
  }

  return json(event);
}
