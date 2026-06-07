import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildChatProbeReport,
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
    pollIntervalMs: 300,
    analysisProfiles: []
  });
});

test('normalizeChatProbeOptions accepts proof mode and requires waitForResponse', () => {
  const options = normalizeChatProbeOptions({
    content: 'repro this',
    proof_mode: 'premature_complete'
  });

  assert.deepEqual(options.analysisProfiles, ['premature_complete']);
  assert.equal(options.waitForResponse, true);
  assert.throws(
    () =>
      normalizeChatProbeOptions({
        content: 'repro this',
        analysisProfiles: ['premature_complete'],
        waitForResponse: false
      }),
    /Analysis profiles require waitForResponse=true/i
  );
});

test('normalizeChatProbeOptions accepts analysis profile arrays', () => {
  const options = normalizeChatProbeOptions({
    content: 'repro this',
    analysis_profiles: ['premature_complete', 'execution_without_tool_progress', 'premature_complete']
  });

  assert.deepEqual(options.analysisProfiles, ['premature_complete', 'execution_without_tool_progress']);
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

test('buildChatProbeReport marks a likely premature complete as proved', () => {
  const report = buildChatProbeReport({
    promptContent: 'Continue the investigation and do not answer until you have concrete findings.',
    responseMessages: [message('assistant-1', 'assistant', 'Let me get more detail on that:')],
    beforeVerdict: {
      code: 'no_obvious_fault',
      summary: 'No obvious fault before the probe.',
      likelyLayer: 'unknown',
      hints: []
    },
    afterVerdict: {
      code: 'likely_premature_complete',
      summary: 'Hermes ended early.',
      likelyLayer: 'hermes_sender',
      hints: []
    },
    analysisProfiles: ['premature_complete']
  });

  assert.equal(report.findings[0].status, 'proved');
  assert.equal(report.promptSummary.looksExecutionOriented, true);
  assert.equal(report.responseSummary.latestAssistantLooksIncomplete, true);
  assert.equal(report.responseSummary.toolProgressCount, 0);
  assert.match(report.findings[0].summary, /reproduced/i);
});

test('buildChatProbeReport reports inconclusive when no assistant response arrives', () => {
  const report = buildChatProbeReport({
    promptContent: 'Continue the investigation.',
    responseMessages: [message('system-1', 'system', 'tool progress')],
    beforeVerdict: null,
    afterVerdict: null,
    analysisProfiles: ['premature_complete']
  });

  assert.equal(report.findings[0].status, 'inconclusive');
  assert.equal(report.responseSummary.latestAssistantMessageId, null);
});

test('buildChatProbeReport proves execution_without_tool_progress on execution-style probes', () => {
  const report = buildChatProbeReport({
    promptContent: 'Continue researching the issue, use tools if needed, and do not answer until you have actual findings.',
    responseMessages: [message('assistant-1', 'assistant', 'Let me check the merger details:')],
    beforeVerdict: null,
    afterVerdict: {
      code: 'likely_premature_complete',
      summary: 'Hermes ended early.',
      likelyLayer: 'hermes_sender',
      hints: []
    },
    analysisProfiles: ['execution_without_tool_progress']
  });

  assert.equal(report.findings[0].profile, 'execution_without_tool_progress');
  assert.equal(report.findings[0].status, 'proved');
  assert.equal(report.responseSummary.hasToolProgress, false);
});

test('buildChatProbeReport does not flag execution_without_tool_progress when tool progress is visible', () => {
  const report = buildChatProbeReport({
    promptContent: 'Continue researching the issue and find the actual facts.',
    responseMessages: [
      { ...message('system-1', 'system', 'terminal: curl facts'), displayType: 'tool_progress' },
      message('assistant-1', 'assistant', 'Here are the verified findings.')
    ],
    beforeVerdict: null,
    afterVerdict: {
      code: 'no_obvious_fault',
      summary: 'Nothing suspicious.',
      likelyLayer: 'unknown',
      hints: []
    },
    analysisProfiles: ['execution_without_tool_progress']
  });

  assert.equal(report.findings[0].status, 'not_reproduced');
  assert.equal(report.responseSummary.hasToolProgress, true);
});
