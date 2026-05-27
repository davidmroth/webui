import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { hasMaintenanceAccess, isMaintenanceEnabled, validateMaintenanceToken } from './maintenance';

function hasValidMaintenanceHeaderToken(request: Request) {
  const headerToken = request.headers.get('x-maintenance-token')?.trim();
  return headerToken ? validateMaintenanceToken(headerToken) : false;
}

export function requireDiagnosticsAccess(event: RequestEvent) {
  if (!isMaintenanceEnabled()) {
    return json(
      {
        success: false,
        error_code: 'DIAGNOSTICS_NOT_CONFIGURED',
        error_message: 'Diagnostics require MAINTENANCE_TOKEN to be configured.'
      },
      { status: 503 }
    );
  }

  if (hasMaintenanceAccess(event) || hasValidMaintenanceHeaderToken(event.request)) {
    return null;
  }

  return json(
    {
      success: false,
      error_code: 'DIAGNOSTICS_FORBIDDEN',
      error_message: 'Maintenance authentication required.'
    },
    { status: 403 }
  );
}
