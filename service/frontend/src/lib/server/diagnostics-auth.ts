import { json } from '@sveltejs/kit';
import { getConfig } from './env';

function safeTokenEquals(actual: string, expected: string) {
  const maxLength = Math.max(actual.length, expected.length);
  let diff = actual.length ^ expected.length;
  for (let index = 0; index < maxLength; index += 1) {
    diff |= (actual.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0);
  }
  return diff === 0;
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

  const actual = request.headers.get('x-diagnostics-token')?.trim() ?? '';
  if (!actual || !safeTokenEquals(actual, expected)) {
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