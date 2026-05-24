import { json } from '@sveltejs/kit';
import { createConversation, listConversations } from '$server/chat';
import { requireSession } from '$server/auth';
import { buildEtag, requestHasMatchingEtag } from './cache';

export async function GET(event) {
  const session = await requireSession(event);
  const conversations = await listConversations(session.userId);
  const body = { conversations };
  const etag = buildEtag(body);

  if (requestHasMatchingEtag(event.request, etag)) {
    return new Response(null, {
      status: 304,
      headers: {
        etag,
        'cache-control': 'private, max-age=0, must-revalidate'
      }
    });
  }

  return json(body, {
    headers: {
      etag,
      'cache-control': 'private, max-age=0, must-revalidate'
    }
  });
}

export async function POST(event) {
  const session = await requireSession(event);
  const body = await event.request.json().catch(() => ({}));
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'New conversation';
  const conversationId = await createConversation(session.userId, title);
  return json({ conversationId }, { status: 201 });
}
