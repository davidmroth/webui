import test from 'node:test';
import assert from 'node:assert/strict';

import { buildEtag, requestHasMatchingEtag } from './+server.ts';

test('messages buildEtag is stable for identical payloads', () => {
  const payload = {
    messages: [{ id: 'm1', role: 'user', content: 'hello' }],
    assistantBusy: false,
    runState: { status: 'idle', active: false, stalled: false }
  };

  const first = buildEtag(payload);
  const second = buildEtag(payload);

  assert.equal(first, second);
  assert.match(first, /^"[a-f0-9]{40}"$/);
});

test('messages buildEtag changes when run state changes', () => {
  const first = buildEtag({
    messages: [{ id: 'm1', role: 'user', content: 'hello' }],
    assistantBusy: false,
    runState: { status: 'idle', active: false, stalled: false }
  });

  const second = buildEtag({
    messages: [{ id: 'm1', role: 'user', content: 'hello' }],
    assistantBusy: true,
    runState: { status: 'queued', active: true, stalled: false }
  });

  assert.notEqual(first, second);
});

test('messages requestHasMatchingEtag handles exact, list, wildcard, and miss', () => {
  const etag = '"messages-etag"';

  const exact = new Request('http://localhost/api/conversations/c1/messages', {
    headers: { 'if-none-match': etag }
  });
  assert.equal(requestHasMatchingEtag(exact, etag), true);

  const list = new Request('http://localhost/api/conversations/c1/messages', {
    headers: { 'if-none-match': '"x", "messages-etag", "y"' }
  });
  assert.equal(requestHasMatchingEtag(list, etag), true);

  const wildcard = new Request('http://localhost/api/conversations/c1/messages', {
    headers: { 'if-none-match': '*' }
  });
  assert.equal(requestHasMatchingEtag(wildcard, etag), true);

  const miss = new Request('http://localhost/api/conversations/c1/messages', {
    headers: { 'if-none-match': '"x", "y"' }
  });
  assert.equal(requestHasMatchingEtag(miss, etag), false);
});
