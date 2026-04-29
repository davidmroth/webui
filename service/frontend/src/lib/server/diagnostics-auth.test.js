import test from 'node:test';
import assert from 'node:assert/strict';
import { requireDiagnosticsToken } from './diagnostics-auth.ts';

test('diagnostics auth fails closed when token is unset', async () => {
  process.env.DIAGNOSTICS_TOKEN = '';
  const response = requireDiagnosticsToken(new Request('http://localhost/api/internal/diagnostics/snapshot'));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error_code, 'DIAGNOSTICS_NOT_CONFIGURED');
});

test('diagnostics auth rejects invalid token', async () => {
  process.env.DIAGNOSTICS_TOKEN = 'expected-token';
  const response = requireDiagnosticsToken(
    new Request('http://localhost/api/internal/diagnostics/snapshot', {
      headers: { 'x-diagnostics-token': 'wrong-token' }
    })
  );
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error_code, 'DIAGNOSTICS_FORBIDDEN');
});

test('diagnostics auth accepts valid token', () => {
  process.env.DIAGNOSTICS_TOKEN = 'expected-token';
  const response = requireDiagnosticsToken(
    new Request('http://localhost/api/internal/diagnostics/snapshot', {
      headers: { 'x-diagnostics-token': 'expected-token' }
    })
  );
  assert.equal(response, null);
});