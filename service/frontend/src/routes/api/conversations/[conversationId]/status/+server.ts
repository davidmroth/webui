import { json } from '@sveltejs/kit';
import { getConversationRunState, isConversationBusy } from '$server/chat';
import { requireSession } from '$server/auth';

export async function GET(event) {
  const session = await requireSession(event);
  const [assistantBusy, runState] = await Promise.all([
    isConversationBusy(session.userId, event.params.conversationId),
    getConversationRunState(session.userId, event.params.conversationId)
  ]);

  return json(
    {
      assistantBusy,
      assistantStalled: runState.status === 'stale',
      runState
    },
    {
      headers: {
        'cache-control': 'no-store',
        'x-poll-interval': '5000'
      }
    }
  );
}