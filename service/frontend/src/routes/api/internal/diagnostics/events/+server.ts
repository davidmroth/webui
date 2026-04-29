import { json } from '@sveltejs/kit';
import { getDiagnosticEvents } from '$server/diagnostics';
import { requireDiagnosticsToken } from '$server/diagnostics-auth';

function optionalParam(url: URL, name: string) {
  const value = url.searchParams.get(name)?.trim();
  return value || null;
}

export async function GET({ request, url }) {
  const denied = requireDiagnosticsToken(request);
  if (denied) {
    return denied;
  }

  const limit = Number(url.searchParams.get('limit') ?? 50);
  return json({
    success: true,
    events: getDiagnosticEvents({
      limit: Number.isFinite(limit) ? limit : 50,
      eventType: optionalParam(url, 'event_type'),
      hop: optionalParam(url, 'hop'),
      entityId: optionalParam(url, 'entity_id'),
      conversationId: optionalParam(url, 'conversation_id'),
      messageId: optionalParam(url, 'message_id'),
      requestId: optionalParam(url, 'request_id'),
      senderTraceId: optionalParam(url, 'sender_trace_id')
    })
  });
}