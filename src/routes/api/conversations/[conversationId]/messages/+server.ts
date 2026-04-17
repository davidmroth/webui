import { json } from '@sveltejs/kit';
import { enqueueUserMessage, listMessages } from '$server/chat';
import { requireSession } from '$server/auth';

export async function GET(event) {
  const session = await requireSession(event);
  const messages = await listMessages(session.userId, event.params.conversationId);
  return json({ messages });
}

export async function POST(event) {
  const session = await requireSession(event);
  const body = await event.request.json().catch(() => ({}));
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (!content) {
    return json({ error: 'Message content is required.' }, { status: 400 });
  }

  const result = await enqueueUserMessage(session.userId, event.params.conversationId, content);
  return json(result, { status: 201 });
}
