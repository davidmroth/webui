import { json } from '@sveltejs/kit';
import { publishHermesTypingIndicator } from '$server/chat';
import { getConfig } from '$server/env';
import { noteHermesWorkerAuthFailure, noteHermesWorkerHeartbeat } from '$server/hermes-heartbeat';

function isAuthorized(request: Request) {
  const expected = getConfig().hermesServiceToken;
  const authHeader = request.headers.get('authorization') || '';
  return authHeader === `Bearer ${expected}`;
}

export async function POST({ params, request }: { params: { conversationId: string }; request: Request }) {
  if (!isAuthorized(request)) {
    noteHermesWorkerAuthFailure('typing');
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  noteHermesWorkerHeartbeat('typing');

  try {
    publishHermesTypingIndicator(params.conversationId, true);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Failed to publish typing indicator.' },
      { status: 400 }
    );
  }

  return json({ ok: true });
}
