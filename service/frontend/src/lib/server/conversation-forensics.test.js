import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildForensicsMessageTail,
  deriveConversationForensicsVerdict,
  looksIncompleteAssistantReply,
  parseConversationIdFromInput
} from './conversation-forensics.ts';

test('looksIncompleteAssistantReply flags preambles and truncated tails', () => {
  assert.equal(looksIncompleteAssistantReply('Let me check the X/Twitter skill:'), true);
  assert.equal(
    looksIncompleteAssistantReply("Good — the skill is there and fully documented. Now let me check if it's actuall"),
    true
  );
  assert.equal(
    looksIncompleteAssistantReply('Here is the full answer with enough detail to stand on its own.'),
    false
  );
});

test('deriveConversationForensicsVerdict detects premature complete sender failures', () => {
  const verdict = deriveConversationForensicsVerdict({
    currNode: 'assistant-1',
    messages: [
      {
        id: 'user-1',
        role: 'user',
        content: 'We already have an x.com skill, right?',
        createdAt: '2026-05-27T12:25:21.000Z',
        updatedAt: '2026-05-27T12:25:21.000Z',
        status: 'complete',
        attachments: [],
        revisionSiblingIds: ['user-1'],
        revisionIndex: 0,
        revisionTotal: 1
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: "Let me check the X/Twitter skill that's listed in my skills:",
        createdAt: '2026-05-27T12:25:26.000Z',
        updatedAt: '2026-05-27T12:25:26.000Z',
        status: 'complete',
        attachments: [],
        timings: { completion_tokens: 16 },
        revisionSiblingIds: ['assistant-1'],
        revisionIndex: 0,
        revisionTotal: 1
      }
    ],
    runState: {
      status: 'completed',
      active: false,
      stalled: false,
      eventId: 'event-1',
      messageId: 'user-1',
      createdAt: '2026-05-27T12:25:21.000Z',
      claimedAt: '2026-05-27T12:25:22.000Z',
      completedAt: '2026-05-27T12:25:26.000Z',
      lastActivityAt: '2026-05-27T12:25:26.000Z',
      errorCode: null,
      errorMessage: null
    },
    lastEvent: {
      id: 'event-1',
      messageId: 'user-1',
      status: 'acked',
      runStatus: 'completed',
      createdAt: '2026-05-27T12:25:21.000Z',
      claimedAt: '2026-05-27T12:25:22.000Z',
      ackedAt: '2026-05-27T12:25:26.000Z',
      runCompletedAt: '2026-05-27T12:25:26.000Z',
      errorCode: null,
      errorMessage: null
    },
    deliveryTraces: [
      {
        id: 'trace-1',
        senderTraceId: 'trace-sender',
        conversationId: 'conv-1',
        receiverMessageId: 'assistant-1',
        route: 'webchat_adapter+timings',
        senderBaseUrl: 'https://webui.example',
        senderTargetUrl: 'https://webui.example/api/internal/hermes/conversations/conv-1/assistant',
        senderHostname: 'host',
        senderSessionPlatform: null,
        senderSessionChatId: null,
        attachmentCount: 0,
        attachmentNames: [],
        contentLength: 60,
        receiverStatus: 'accepted',
        errorText: null,
        createdAt: '2026-05-27T12:25:26.000Z'
      }
    ],
    diagnosticFailures: 0
  });

  assert.equal(verdict.code, 'likely_premature_complete');
  assert.equal(verdict.likelyLayer, 'hermes_sender');
});

test('deriveConversationForensicsVerdict detects tool progress without follow-up', () => {
  const verdict = deriveConversationForensicsVerdict({
    currNode: 'tool-1',
    messages: [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Let me run the actual command:',
        createdAt: '2026-05-27T12:49:06.000Z',
        updatedAt: '2026-05-27T12:49:06.000Z',
        status: 'complete',
        attachments: [],
        revisionSiblingIds: ['assistant-1'],
        revisionIndex: 0,
        revisionTotal: 1
      },
      {
        id: 'tool-1',
        role: 'system',
        displayType: 'tool_progress',
        content: 'terminal: which xurl',
        createdAt: '2026-05-27T12:49:06.000Z',
        updatedAt: '2026-05-27T12:49:06.000Z',
        status: 'complete',
        attachments: [],
        revisionSiblingIds: ['tool-1'],
        revisionIndex: 0,
        revisionTotal: 1
      }
    ],
    runState: { status: 'idle', active: false, stalled: false },
    lastEvent: null,
    deliveryTraces: [],
    diagnosticFailures: 0
  });

  assert.equal(verdict.code, 'awaiting_assistant_after_tool');
});

test('parseConversationIdFromInput accepts raw ids and chat URLs', () => {
  assert.equal(parseConversationIdFromInput('c0fef13b-50bd-43de-ad15-780acc560cb3'), 'c0fef13b-50bd-43de-ad15-780acc560cb3');
  assert.equal(
    parseConversationIdFromInput(
      'https://webui.example/chat?conversation=c0fef13b-50bd-43de-ad15-780acc560cb3'
    ),
    'c0fef13b-50bd-43de-ad15-780acc560cb3'
  );
});

test('buildForensicsMessageTail returns compact tail rows', () => {
  const tail = buildForensicsMessageTail([
    {
      id: 'assistant-1',
      role: 'assistant',
      content: 'Let me check the skill',
      createdAt: '2026-05-27T12:25:26.000Z',
      updatedAt: '2026-05-27T12:25:26.000Z',
      status: 'complete',
      attachments: [],
      timings: { completion_tokens: 16 },
      revisionSiblingIds: ['assistant-1'],
      revisionIndex: 0,
      revisionTotal: 1
    }
  ]);

  assert.equal(tail.length, 1);
  assert.equal(tail[0].hasTimings, true);
  assert.match(tail[0].contentSnippet, /Let me check/);
});
