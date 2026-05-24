import test from 'node:test';
import assert from 'node:assert/strict';

import { buildEtag, requestHasMatchingEtag } from './cache.ts';

test('buildEtag is stable for identical payloads', () => {
  const payload = { conversations: [{ id: 'a', title: 'Alpha' }] };
  const first = buildEtag(payload);
  const second = buildEtag(payload);

  assert.equal(first, second);
  assert.match(first, /^"[a-f0-9]{40}"$/);
});

test('buildEtag changes when payload changes', () => {
  const first = buildEtag({ conversations: [{ id: 'a', title: 'Alpha' }] });
  const second = buildEtag({ conversations: [{ id: 'a', title: 'Beta' }] });

  assert.notEqual(first, second);
});

test('requestHasMatchingEtag returns true for exact match', () => {
  const etag = '"abc123"';
  const request = new Request('http://localhost/api/conversations', {
    headers: { 'if-none-match': etag }
  });

  assert.equal(requestHasMatchingEtag(request, etag), true);
});

test('requestHasMatchingEtag returns true for wildcard', () => {
  const etag = '"abc123"';
  const request = new Request('http://localhost/api/conversations', {
    headers: { 'if-none-match': '*' }
  });

  assert.equal(requestHasMatchingEtag(request, etag), true);
});

test('requestHasMatchingEtag supports comma-separated ETags', () => {
  const etag = '"target"';
  const request = new Request('http://localhost/api/conversations', {
    headers: { 'if-none-match': '"other", "target", "third"' }
  });

  assert.equal(requestHasMatchingEtag(request, etag), true);
});

test('requestHasMatchingEtag returns false when no candidate matches', () => {
  const etag = '"target"';
  const request = new Request('http://localhost/api/conversations', {
    headers: { 'if-none-match': '"other", "third"' }
  });

  assert.equal(requestHasMatchingEtag(request, etag), false);
});

test('requestHasMatchingEtag returns false when header is absent', () => {
  const etag = '"target"';
  const request = new Request('http://localhost/api/conversations');

  assert.equal(requestHasMatchingEtag(request, etag), false);
});
