import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getChangedConversationIdsForReplyChecks,
  getLatestTerminalAssistantMessageId,
  getLatestUnseenAssistantReply,
  rememberSeenAssistantMessages,
  shouldNotifyAssistantReply
} from './chat-notification-policy.ts';

function createMessage(overrides = {}) {
  return {
    id: 'message-1',
    role: 'assistant',
    content: 'reply',
    createdAt: '2026-04-23T00:00:00.000Z',
    status: 'complete',
    attachments: [],
    ...overrides
  };
}

test('rememberSeenAssistantMessages only stores completed non-pending assistant replies', () => {
  const seen = rememberSeenAssistantMessages(new Set(['assistant-0']), [
    createMessage({ id: 'assistant-1', status: 'complete' }),
    createMessage({ id: 'assistant-2', status: 'streaming' }),
    createMessage({ id: 'pending-assistant-3', status: 'complete' }),
    createMessage({ id: 'user-1', role: 'user' })
  ]);

  assert.deepEqual([...seen].sort(), ['assistant-0', 'assistant-1']);
});

test('getLatestUnseenAssistantReply returns the newest unseen completed assistant reply', () => {
  const latest = getLatestUnseenAssistantReply(new Set(['assistant-1']), [
    createMessage({ id: 'assistant-1', content: 'old reply' }),
    createMessage({ id: 'assistant-2', status: 'streaming', content: 'in progress' }),
    createMessage({ id: 'assistant-3', content: 'latest reply' })
  ]);

  assert.equal(latest?.id, 'assistant-3');
});

test('getLatestTerminalAssistantMessageId ignores pending placeholders and prefers the newest terminal reply', () => {
  assert.equal(
    getLatestTerminalAssistantMessageId([
      createMessage({ id: 'assistant-1', status: 'complete' }),
      createMessage({ id: 'pending-assistant-2', status: 'error' }),
      createMessage({ id: 'assistant-3', status: 'error' })
    ]),
    'assistant-3'
  );
});

test('shouldNotifyAssistantReply requires granted notifications and a background or cross-conversation trigger', () => {
  assert.equal(
    shouldNotifyAssistantReply({
      notificationsEnabled: true,
      notificationPermission: 'granted',
      conversationId: 'conversation-1',
      currentConversationId: 'conversation-1',
      documentVisibility: 'visible',
      documentHasFocus: true
    }),
    false
  );

  assert.equal(
    shouldNotifyAssistantReply({
      notificationsEnabled: true,
      notificationPermission: 'granted',
      conversationId: 'conversation-1',
      currentConversationId: 'conversation-1',
      documentVisibility: 'hidden',
      documentHasFocus: false
    }),
    true
  );

  assert.equal(
    shouldNotifyAssistantReply({
      notificationsEnabled: true,
      notificationPermission: 'granted',
      conversationId: 'conversation-2',
      currentConversationId: 'conversation-1',
      documentVisibility: 'visible',
      documentHasFocus: true
    }),
    true
  );
});

test('getChangedConversationIdsForReplyChecks catches updated conversations and busy-to-idle transitions', () => {
  assert.deepEqual(
    getChangedConversationIdsForReplyChecks({
      currentConversationId: 'conversation-1',
      nextConversations: [
        { id: 'conversation-1', title: 'Current', updatedAt: '2026-04-23T10:00:00Z', assistantBusy: false },
        { id: 'conversation-2', title: 'Updated', updatedAt: '2026-04-23T11:00:00Z', assistantBusy: false },
        { id: 'conversation-3', title: 'Busy ended', updatedAt: '2026-04-23T10:00:00Z', assistantBusy: false },
        { id: 'conversation-4', title: 'Unchanged', updatedAt: '2026-04-23T10:00:00Z', assistantBusy: false }
      ],
      previousUpdatedAtById: {
        'conversation-1': '2026-04-23T09:00:00Z',
        'conversation-2': '2026-04-23T10:00:00Z',
        'conversation-3': '2026-04-23T10:00:00Z',
        'conversation-4': '2026-04-23T10:00:00Z'
      },
      previousBusyById: {
        'conversation-1': false,
        'conversation-2': false,
        'conversation-3': true,
        'conversation-4': false
      }
    }),
    ['conversation-2', 'conversation-3']
  );
});