import { json } from '@sveltejs/kit';
import { getConversationRunState, isConversationBusy } from '$server/chat';
import { requireSession } from '$server/auth';
import { collectMaintenanceHermesConnectionStatus } from '$server/maintenance';

export async function GET(event) {
  const session = await requireSession(event);
  const [assistantBusy, runState, hermesConnection] = await Promise.all([
    isConversationBusy(session.userId, event.params.conversationId),
    getConversationRunState(session.userId, event.params.conversationId),
    collectMaintenanceHermesConnectionStatus()
  ]);

  const assistantStalled =
    runState.status === 'stale' ||
    (runState.status === 'queued' && hermesConnection.workerHeartbeat.isOnline === false);

  return json(
    {
      assistantBusy,
      assistantStalled,
      runState,
      hermesConnection
    },
    {
      headers: {
        'cache-control': 'no-store'
      }
    }
  );
}