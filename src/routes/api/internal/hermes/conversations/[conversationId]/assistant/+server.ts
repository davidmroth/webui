import { json } from '@sveltejs/kit';
import { storeAssistantMessage } from '$server/chat';
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

  const body = await request.json().catch(() => ({}));
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (!content) {
    return json({ error: 'Assistant content is required.' }, { status: 400 });
  }

  const messageId = await storeAssistantMessage(params.conversationId, content);
  return json({ ok: true, messageId }, { status: 201 });
}
