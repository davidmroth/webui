import { json } from '@sveltejs/kit';
import { ackHermesEvent } from '$server/chat';
import { getConfig } from '$server/env';

function isAuthorized(request: Request) {
  const expected = getConfig().hermesServiceToken;
  const authHeader = request.headers.get('authorization') || '';
  return authHeader === `Bearer ${expected}`;
}

export async function POST({ params, request }) {
  if (!isAuthorized(request)) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  await ackHermesEvent(params.eventId);
  return json({ ok: true });
}
