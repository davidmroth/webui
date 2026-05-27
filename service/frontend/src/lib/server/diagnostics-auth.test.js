import test from 'node:test';
import assert from 'node:assert/strict';

function buildEvent({ headers = {}, cookies = undefined } = {}) {
  return {
    request: new Request('http://localhost/api/internal/diagnostics/snapshot', { headers }),
    url: new URL('http://localhost/api/internal/diagnostics/snapshot'),
    cookies: {
      get: cookies ?? (() => undefined)
    }
  };
}

test('diagnostics auth fails closed when maintenance token is unset', async () => {
  process.env.MAINTENANCE_TOKEN = '';
  const { requireDiagnosticsAccess } = await import('./diagnostics-auth.ts');
  const response = requireDiagnosticsAccess(buildEvent());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error_code, 'DIAGNOSTICS_NOT_CONFIGURED');
});

test('diagnostics auth rejects invalid maintenance token', async () => {
  process.env.MAINTENANCE_TOKEN = 'maintenance-token';
  const { requireDiagnosticsAccess } = await import('./diagnostics-auth.ts');
  const response = requireDiagnosticsAccess(
    buildEvent({
      headers: { authorization: 'Bearer wrong-token' }
    })
  );
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error_code, 'DIAGNOSTICS_FORBIDDEN');
});

test('diagnostics auth accepts maintenance bearer token', async () => {
  process.env.MAINTENANCE_TOKEN = 'maintenance-token';
  const { requireDiagnosticsAccess } = await import('./diagnostics-auth.ts');
  const response = requireDiagnosticsAccess(
    buildEvent({
      headers: { authorization: 'Bearer maintenance-token' }
    })
  );
  assert.equal(response, null);
});

test('diagnostics auth accepts x-maintenance-token header', async () => {
  process.env.MAINTENANCE_TOKEN = 'maintenance-token';
  const { requireDiagnosticsAccess } = await import('./diagnostics-auth.ts');
  const response = requireDiagnosticsAccess(
    buildEvent({
      headers: { 'x-maintenance-token': 'maintenance-token' }
    })
  );
  assert.equal(response, null);
});
