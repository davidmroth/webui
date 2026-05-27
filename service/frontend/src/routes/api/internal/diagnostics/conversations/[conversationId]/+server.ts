import { json } from '@sveltejs/kit';
import { collectConversationForensics } from '$server/conversation-forensics';
import { requireDiagnosticsAccess } from '$server/diagnostics-auth';

function parseLimit(url: URL) {
  const limit = Number(url.searchParams.get('limit') ?? 20);
  return Number.isFinite(limit) ? Math.min(50, Math.max(1, Math.floor(limit))) : 20;
}

export async function GET(event) {
  const denied = requireDiagnosticsAccess(event);
  if (denied) {
    return denied;
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
      { status: 404 }
    );
  }

  return json({
    success: true,
    ...forensics
  });
}
