import { json } from '@sveltejs/kit';
import { deleteMessageForUser } from '$server/chat';
import { requireSession } from '$server/auth';

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
