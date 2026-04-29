import { json } from '@sveltejs/kit';
import { DiagnosticEventType, DiagnosticHop, emitDiagnosticEvent } from '$server/diagnostics';
import { getConfig } from '$server/env';

function isAuthorized(request: Request) {
  const expected = getConfig().hermesServiceToken;
  const authHeader = request.headers.get('authorization') || '';
  return authHeader === `Bearer ${expected}`;
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export async function POST({ request }) {
  if (!isAuthorized(request)) {
    return json({ success: false, error_code: 'UNAUTHORIZED', error_message: 'Unauthorized' }, { status: 401 });
  }

  const body: Record<string, unknown> = await request.json().catch(() => ({}));
  const conversationId = optionalString(body.conversationId);
  emitDiagnosticEvent(
    DiagnosticEventType.HermesGatewayStatusReceived,
    DiagnosticHop.HermesWorker,
    {
      platform: optionalString(body.platform),
      component: optionalString(body.component),
      status: optionalString(body.status),
      eventType: optionalString(body.event_type),
      attempt: Number.isFinite(body.attempt) ? Number(body.attempt) : null,
      maxAttempts: Number.isFinite(body.max_attempts) ? Number(body.max_attempts) : null,
      nextRetrySeconds: Number.isFinite(body.next_retry_seconds) ? Number(body.next_retry_seconds) : null,
      errorCode: optionalString(body.error_code),
      errorMessage: optionalString(body.error_message),
      sessionKey: optionalString(body.session_key),
      conversationId
    },
    conversationId
  );

  return json({ success: true });
}