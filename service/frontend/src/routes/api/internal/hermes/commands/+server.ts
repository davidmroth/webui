import { json } from '@sveltejs/kit';
import { getConfig } from '$server/env';
import { noteHermesWorkerAuthFailure, noteHermesWorkerHeartbeat } from '$server/hermes-heartbeat';
import { updateHermesSlashCommands } from '$server/slash-commands';

function isAuthorized(request: Request) {
  const expected = getConfig().hermesServiceToken;
  const authHeader = request.headers.get('authorization') || '';
  return authHeader === `Bearer ${expected}`;
}

export async function POST({ request }) {
  if (!isAuthorized(request)) {
    noteHermesWorkerAuthFailure('commands');
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const payload = await request.json().catch(() => ({}));
  const updated = updateHermesSlashCommands(payload?.commands);
  noteHermesWorkerHeartbeat('commands');

  if (!updated) {
    return json({ error: 'No valid slash commands received.' }, { status: 400 });
  }

  return json({ ok: true });
}
