import test from 'node:test';
import assert from 'node:assert/strict';

import { isCurrentConversationRequest } from './current-conversation-request.ts';

test('current conversation request matches only the still-active conversation', () => {
  assert.equal(isCurrentConversationRequest('conversation-1', 'conversation-1'), true);
  assert.equal(isCurrentConversationRequest('conversation-1', 'conversation-2'), false);
});

test('current conversation request rejects empty request targets', () => {
  assert.equal(isCurrentConversationRequest(null, 'conversation-1'), false);
  assert.equal(isCurrentConversationRequest('', 'conversation-1'), false);
});