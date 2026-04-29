import { json } from '@sveltejs/kit';
import { getDiagnosticEntity } from '$server/diagnostics';
import { requireDiagnosticsToken } from '$server/diagnostics-auth';

export async function GET({ params, request }) {
  const denied = requireDiagnosticsToken(request);
  if (denied) {
    return denied;
  }

  return json({
    success: true,
    entityId: params.entityId,
    ...getDiagnosticEntity(params.entityId)
  });
}