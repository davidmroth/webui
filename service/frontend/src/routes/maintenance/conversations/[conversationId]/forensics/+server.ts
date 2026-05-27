import { json } from '@sveltejs/kit';
import { collectConversationForensics } from '$server/conversation-forensics';
import { hasMaintenanceAccess, isMaintenanceEnabled } from '$server/maintenance';

const NO_STORE_HEADERS = {
  'cache-control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  pragma: 'no-cache',
  expires: '0'
};

function parseLimit(url: URL) {
  const limit = Number(url.searchParams.get('limit') ?? 20);
  return Number.isFinite(limit) ? Math.min(50, Math.max(1, Math.floor(limit))) : 20;
}

export async function GET(event) {
  if (!isMaintenanceEnabled() || !hasMaintenanceAccess(event)) {
    return json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE_HEADERS });
  }

  const forensics = await collectConversationForensics(event.params.conversationId, {
    eventLimit: parseLimit(event.url)
  });
  if (!forensics) {
    return json(
      {
        success: false,
        error_code: 'CONVERSATION_FORENSICS_NOT_FOUND',
        error_message: 'Conversation not found.'
      },
      { status: 404, headers: NO_STORE_HEADERS }
    );
  }

  return json(
    {
      success: true,
      ...forensics
    },
    { headers: NO_STORE_HEADERS }
  );
}
