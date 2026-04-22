import { json } from '@sveltejs/kit';
import { requireSession } from '$server/auth';
import { selectMessageRevision } from '$server/chat';

export async function POST(event) {
  const session = await requireSession(event);
  const result = await selectMessageRevision(
    session.userId,
    event.params.conversationId,
    event.params.messageId
  );

  if (!result) {
    return json({ error: 'Message revision not found.' }, { status: 404 });
  }

  return json({ ok: true, ...result });
}