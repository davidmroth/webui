import { json } from '@sveltejs/kit';
import { deleteMessageForUser, editUserMessage } from '$server/chat';
import { requireSession } from '$server/auth';

export async function PATCH(event) {
  const session = await requireSession(event);
  const body = await event.request.json().catch(() => ({}));
  const content = typeof body.content === 'string' ? body.content.trim() : '';

  if (!content) {
    return json({ error: 'Message content is required.' }, { status: 400 });
  }

  const result = await editUserMessage(
    session.userId,
    event.params.conversationId,
    event.params.messageId,
    content
  );
  if (!result) {
    return json({ error: 'User message not found.' }, { status: 404 });
  }

  return json({ ok: true, ...result });
}

export async function DELETE(event) {
  const session = await requireSession(event);
  const deleted = await deleteMessageForUser(
    session.userId,
    event.params.conversationId,
    event.params.messageId
  );
  if (!deleted) {
    return json({ error: 'Message not found.' }, { status: 404 });
  }
  return json({ ok: true });
}
