import { json } from '@sveltejs/kit';
import {
  deleteConversationForUser,
  exportConversationForUser,
  renameConversationForUser
} from '$server/chat';
import { requireSession } from '$server/auth';

export async function GET(event) {
  const session = await requireSession(event);
  const payload = await exportConversationForUser(session.userId, event.params.conversationId);

  if (!payload) {
    return json({ error: 'Conversation not found.' }, { status: 404 });
  }

  return json(payload, {
    headers: {
      'cache-control': 'no-store'
    }
  });
}

export async function PATCH(event) {
  const session = await requireSession(event);
  const body = await event.request.json().catch(() => ({}));
  const title = typeof body.title === 'string' ? body.title.trim() : '';

  if (!title) {
    return json({ error: 'Conversation title is required.' }, { status: 400 });
  }

  const renamed = await renameConversationForUser(
    session.userId,
    event.params.conversationId,
    title
  );

  if (!renamed) {
    return json({ error: 'Conversation not found.' }, { status: 404 });
  }

  return json({ ok: true });
}

export async function DELETE(event) {
  const session = await requireSession(event);
  const deleted = await deleteConversationForUser(session.userId, event.params.conversationId);

  if (!deleted) {
    return json({ error: 'Conversation not found.' }, { status: 404 });
  }

  return json({ ok: true });
}