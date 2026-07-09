import { json } from '@sveltejs/kit';
import { getHermesEventStatus } from '$server/chat';
import { getConfig } from '$server/env';
import { noteHermesWorkerAuthFailure, noteHermesWorkerHeartbeat } from '$server/hermes-heartbeat';

function isAuthorized(request: Request) {
  const expected = getConfig().hermesServiceToken;
  const authHeader = request.headers.get('authorization') || '';
  return authHeader === `Bearer ${expected}`;
}

export async function GET({ params, request }) {
  if (!isAuthorized(request)) {
    noteHermesWorkerAuthFailure('event-status');
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  noteHermesWorkerHeartbeat('event-status');

  const eventId = params.eventId?.trim();
  if (!eventId) {
    return json({ error: 'eventId required' }, { status: 400 });
  }

  const status = await getHermesEventStatus(eventId);
  if (!status) {
    return json({ error: 'Event not found' }, { status: 404 });
  }

  return json(status);
}
