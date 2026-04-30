import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findProbeResponseMessages,
  normalizeChatProbeOptions,
  waitForProbeResponses
} from './diagnostics-chat-probe.ts';

function message(id, role, content = '') {
  return {
    id,
    role,
    content,
    createdAt: '2026-04-30T00:00:00.000Z',
    status: 'complete',
    attachments: []
  };
}

test('normalizeChatProbeOptions accepts camelCase and snake_case fields', () => {
  const options = normalizeChatProbeOptions({
    content: '  hello telemetry  ',
    conversation_id: 'conv-1',
    wait_for_response: 'false',
    timeout_ms: '2500',
    poll_interval_ms: '300'
  });

  assert.deepEqual(options, {
    content: 'hello telemetry',
    conversationId: 'conv-1',
    title: 'Diagnostics chat probe',
    waitForResponse: false,
    timeoutMs: 2500,
    pollIntervalMs: 300
  });
});

test('normalizeChatProbeOptions rejects empty content', () => {
  assert.throws(() => normalizeChatProbeOptions({ content: '   ' }), /content is required/i);
});

test('findProbeResponseMessages returns assistant and system messages after the probe user message', () => {
  const messages = [
    message('user-old', 'user', 'old'),
    message('assistant-old', 'assistant', 'old response'),
    message('user-probe', 'user', 'probe'),
    message('system-progress', 'system', 'tool progress'),
    message('assistant-probe', 'assistant', 'probe response'),
    message('user-next', 'user', 'next')
  ];

  assert.deepEqual(
    findProbeResponseMessages(messages, 'user-probe').map((entry) => entry.id),
    ['system-progress', 'assistant-probe']
  );
});

test('waitForProbeResponses completes when a response appears', async () => {
  let calls = 0;
  let currentTime = 0;
  const result = await waitForProbeResponses({
    userMessageId: 'user-probe',
    timeoutMs: 1000,
    pollIntervalMs: 250,
    now: () => currentTime,
    sleep: async (milliseconds) => {
      currentTime += milliseconds;
    },
    loadMessages: async () => {
      calls += 1;
      return calls < 3
        ? [message('user-probe', 'user', 'probe')]
        : [message('user-probe', 'user', 'probe'), message('assistant-probe', 'assistant', 'done')];
    }
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.responseMessages[0].id, 'assistant-probe');
  assert.equal(result.elapsedMs, 500);
});

test('waitForProbeResponses times out without a response', async () => {
  let currentTime = 0;
  const result = await waitForProbeResponses({
    userMessageId: 'user-probe',
    timeoutMs: 500,
    pollIntervalMs: 250,
    now: () => currentTime,
    sleep: async (milliseconds) => {
      currentTime += milliseconds;
    },
    loadMessages: async () => [message('user-probe', 'user', 'probe')]
  });

  assert.equal(result.status, 'timed_out');
  assert.equal(result.responseMessages.length, 0);
  assert.equal(result.elapsedMs, 500);
});
