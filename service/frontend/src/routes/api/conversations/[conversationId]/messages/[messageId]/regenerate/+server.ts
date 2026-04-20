import { json } from '@sveltejs/kit';
import { regenerateAssistantMessage } from '$server/chat';
import { requireSession } from '$server/auth';

export async function POST(event) {
  const session = await requireSession(event);
  const result = await regenerateAssistantMessage(
    session.userId,
    event.params.conversationId,
    event.params.messageId
  );
  if (!result) {
    return json(
      { error: 'Cannot regenerate this message (not found or no preceding user turn).' },
      { status: 400 }
    );
  }
  return json({ ok: true, ...result });
}
