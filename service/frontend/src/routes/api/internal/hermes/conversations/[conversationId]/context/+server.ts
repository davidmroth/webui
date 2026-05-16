import { json } from '@sveltejs/kit';
import { exportConversationForHermes } from '$server/chat';
import { getConfig } from '$server/env';
import { noteHermesWorkerAuthFailure, noteHermesWorkerHeartbeat } from '$server/hermes-heartbeat';
import { derivePublicBaseUrl } from '$server/public-base-url';

function isAuthorized(request: Request) {
  const expected = getConfig().hermesServiceToken;
  const authHeader = request.headers.get('authorization') || '';
  return authHeader === `Bearer ${expected}`;
}

export async function GET({ params, request }: { params: { conversationId: string }; request: Request }) {
  if (!isAuthorized(request)) {
    noteHermesWorkerAuthFailure('context');
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  noteHermesWorkerHeartbeat('context');

  const payload = await exportConversationForHermes(params.conversationId, {
    publicBaseUrl: derivePublicBaseUrl(request, request.url ? new URL(request.url).origin : '')
  });
  if (!payload) {
    return json({ error: 'Conversation not found.' }, { status: 404 });
  }

  return json(payload, {
    headers: {
      'cache-control': 'no-store'
    }
  });
}