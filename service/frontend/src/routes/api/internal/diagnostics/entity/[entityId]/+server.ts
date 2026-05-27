import { json } from '@sveltejs/kit';
import { getDiagnosticEntity } from '$server/diagnostics';
import { requireDiagnosticsAccess } from '$server/diagnostics-auth';

export async function GET(event) {
  const denied = requireDiagnosticsAccess(event);
  if (denied) {
    return denied;
  }

  return json({
    success: true,
    entityId: event.params.entityId,
    ...getDiagnosticEntity(event.params.entityId)
  });
}