import { json } from '@sveltejs/kit';
import { createConversation, listConversations } from '$server/chat';
import { requireSession } from '$server/auth';

export async function GET(event) {
  const session = await requireSession(event);
  const conversations = await listConversations(session.userId);
  return json({ conversations });
}

export async function POST(event) {
  const session = await requireSession(event);
  const body = await event.request.json().catch(() => ({}));
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'New conversation';
  const conversationId = await createConversation(session.userId, title);
  return json({ conversationId }, { status: 201 });
}
