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
    noteHermesWorkerAuthFailure('typing-stop');
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  noteHermesWorkerHeartbeat('typing-stop');

  try {
    publishHermesTypingIndicator(params.conversationId, false);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Failed to clear typing indicator.' },
      { status: 400 }
    );
  }

  return json({ ok: true });
}
