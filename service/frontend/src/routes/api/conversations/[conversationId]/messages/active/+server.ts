import { json, error } from '@sveltejs/kit';
import { requireSession } from '$server/auth';
import { cancelActiveAssistantTurn } from '$server/chat';

/**
 * Stop the in-flight assistant turn for a conversation. Marks any queued or
 * processing Hermes events cancelled and finalizes any streaming assistant
 * message with the chunks captured so far.
 */
export async function DELETE(event) {
  const session = await requireSession(event);
  const { conversationId } = event.params;
  if (!conversationId) {
    throw error(400, 'conversationId required');
  }
  const cancelled = await cancelActiveAssistantTurn(session.userId, conversationId);
  return json({ cancelled });
}
