import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { getConfig } from './env';
import { hasMaintenanceAccess, validateMaintenanceToken } from './maintenance';

function safeTokenEquals(actual: string, expected: string) {
  const maxLength = Math.max(actual.length, expected.length);
  let diff = actual.length ^ expected.length;
  for (let index = 0; index < maxLength; index += 1) {
    diff |= (actual.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0);
  }
  return diff === 0;
}

function parseBearerToken(header: string | null) {
  if (!header?.startsWith('Bearer ')) {
    return null;
  }
  const token = header.slice('Bearer '.length).trim();
  return token || null;
}

function hasValidDiagnosticsToken(request: Request) {
  const expected = getConfig().diagnosticsToken.trim();
  if (!expected) {
    return false;
  }
  const actual = request.headers.get('x-diagnostics-token')?.trim() ?? '';
  return Boolean(actual && safeTokenEquals(actual, expected));
}

function hasValidMaintenanceHeaderToken(request: Request) {
  const headerToken =
    request.headers.get('x-maintenance-token')?.trim() ??
    parseBearerToken(request.headers.get('authorization'));
  return headerToken ? validateMaintenanceToken(headerToken) : false;
}

export function requireDiagnosticsToken(request: Request) {
  const expected = getConfig().diagnosticsToken.trim();
  if (!expected) {
    return json(
      {
        success: false,
        error_code: 'DIAGNOSTICS_NOT_CONFIGURED',
        error_message: 'Diagnostics are not configured.'
      },
      { status: 503 }
    );
  }

  if (!hasValidDiagnosticsToken(request)) {
    return json(
      {
        success: false,
        error_code: 'DIAGNOSTICS_FORBIDDEN',
        error_message: 'Invalid diagnostics token.'
      },
      { status: 403 }
    );
  }

  return null;
}

export function requireDiagnosticsAccess(event: RequestEvent) {
  if (hasValidDiagnosticsToken(event.request)) {
    return null;
  }

  if (hasMaintenanceAccess(event) || hasValidMaintenanceHeaderToken(event.request)) {
    return null;
  }

  const expected = getConfig().diagnosticsToken.trim();
  if (!expected) {
    return json(
      {
        success: false,
        error_code: 'DIAGNOSTICS_NOT_CONFIGURED',
        error_message:
          'Diagnostics are not configured. Use a maintenance session or set DIAGNOSTICS_TOKEN.'
      },
      { status: 503 }
    );
  }

  return json(
    {
      success: false,
      error_code: 'DIAGNOSTICS_FORBIDDEN',
      error_message: 'Invalid diagnostics or maintenance token.'
    },
    { status: 403 }
  );
}
