import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildRecentAssistantTimingsTelemetry,
  buildHermesConnectionStatus,
  buildHermesInboxContractPreview,
  getBuildInfo,
  resolveBuildFingerprint
} from './maintenance.ts';

async function createTempBuildDirectory() {
  return mkdtemp(join(tmpdir(), 'hermes-webui-build-info-'));
}

test('getBuildInfo prefers the git tag as the surfaced frontend version', async (t) => {
  const tempDir = await createTempBuildDirectory();
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  t.mock.method(process, 'cwd', () => tempDir);

  await writeFile(
    join(tempDir, 'version.json'),
    JSON.stringify({
      frontend: '0.2.9.6',
      gitTag: 'v0.2.10',
      gitCommit: 'abc123def456',
      gitCommitShort: 'abc123d',
      gitBranch: 'main',
      buildTime: '2026-04-23T12:00:00.000Z'
    })
  );

  const build = await getBuildInfo();

  assert.equal(build.source, 'version.json');
  assert.equal(build.frontend, 'v0.2.10');
  assert.equal(build.gitTag, 'v0.2.10');
});

test('getBuildInfo falls back to the baked frontend version when no git tag exists', async (t) => {
  const tempDir = await createTempBuildDirectory();
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  t.mock.method(process, 'cwd', () => tempDir);

  await writeFile(
    join(tempDir, '.build.json'),
    JSON.stringify({
      frontend: '0.2.9.6',
      gitTag: 'no-tag',
      gitCommit: 'abc123def456',
      gitCommitShort: 'abc123d',
      gitBranch: 'main',
      buildTime: '2026-04-23T12:00:00.000Z'
    })
  );

  const build = await getBuildInfo();

  assert.equal(build.source, '.build.json');
  assert.equal(build.frontend, '0.2.9.6');
  assert.equal(build.gitTag, 'no-tag');
});

test('resolveBuildFingerprint includes the git commit when present', () => {
  const fingerprint = resolveBuildFingerprint({
    frontend: '0.2.9.6',
    gitTag: 'v0.2.10',
    gitCommit: 'abc123def456'
  });

  assert.equal(fingerprint, 'v0.2.10@abc123def456');
});

test('resolveBuildFingerprint falls back to the version when commit metadata is unavailable', () => {
  const fingerprint = resolveBuildFingerprint({
    frontend: '0.2.9.6',
    gitTag: 'no-tag',
    gitCommit: 'unknown'
  });

  assert.equal(fingerprint, '0.2.9.6');
});

test('buildHermesInboxContractPreview derives the conversation-scoped session contract fields', () => {
  const preview = buildHermesInboxContractPreview({
    event_id: 'evt-1',
    status: 'queued',
    conversation_id: 'conv-1',
    conversation_title: 'Alpha',
    curr_node: 'msg-2',
    last_modified: '42',
    message_id: 'msg-3',
    content: 'Latest browser turn',
    attachment_count: '2',
    created_at: '2026-04-25T12:34:56.000Z'
  });

  assert.deepEqual(preview, {
    eventId: 'evt-1',
    status: 'queued',
    conversationId: 'conv-1',
    conversationName: 'Alpha',
    messageId: 'msg-3',
    createdAt: '2026-04-25T12:34:56.000Z',
    messagePreview: 'Latest browser turn',
    attachmentCount: 2,
    sessionPlatform: 'webui-conversation',
    sessionChatId: 'conv-1',
    contextUrl: '/api/internal/hermes/conversations/conv-1/context',
    contextVersion: {
      currNode: 'msg-2',
      lastModified: 42
    }
  });
});

test('buildHermesConnectionStatus reports a connected worker when heartbeat is fresh', () => {
  const status = buildHermesConnectionStatus({
    queue: {
      queued: 1,
      processing: 0,
      acked: 4,
      staleProcessing: 0,
      leaseSeconds: 60
    },
    workerHeartbeat: {
      seen: true,
      lastSeenAt: '2026-05-04T14:00:55.000Z',
      ageSeconds: 5,
      staleAfterSeconds: 30,
      isOnline: true,
      source: 'inbox-next',
      authFailure: {
        seen: false,
        lastSeenAt: null,
        ageSeconds: null,
        source: null,
        reason: null
      }
    },
    inboxContract: {
      ok: true,
      hasPendingEvent: true,
      preview: {
        eventId: 'evt-1',
        status: 'queued',
        conversationId: 'conv-1',
        conversationName: 'Alpha',
        messageId: 'msg-1',
        createdAt: '2026-05-04T14:00:30.000Z',
        messagePreview: 'Preview',
        attachmentCount: 0,
        sessionPlatform: 'webui-conversation',
        sessionChatId: 'conv-1',
        contextUrl: '/api/internal/hermes/conversations/conv-1/context',
        contextVersion: {
          currNode: null,
          lastModified: 0
        }
      },
      error: null
    },
    hermesServiceTokenConfigured: true,
    nowMs: Date.parse('2026-05-04T14:01:00.000Z')
  });

  assert.equal(status.state, 'connected');
  assert.equal(status.label, 'Connected');
  assert.equal(status.pendingEvent.ageSeconds, 30);
  assert.match(status.summary, /Hermes is online/);
});

test('buildHermesConnectionStatus reports recent auth failures as degraded', () => {
  const status = buildHermesConnectionStatus({
    queue: {
      queued: 2,
      processing: 0,
      acked: 0,
      staleProcessing: 0,
      leaseSeconds: 60
    },
    workerHeartbeat: {
      seen: false,
      lastSeenAt: null,
      ageSeconds: null,
      staleAfterSeconds: 30,
      isOnline: false,
      source: null,
      authFailure: {
        seen: true,
        lastSeenAt: '2026-05-04T14:00:10.000Z',
        ageSeconds: 50,
        source: 'health',
        reason: 'unauthorized'
      }
    },
    inboxContract: {
      ok: true,
      hasPendingEvent: false,
      preview: null,
      error: null
    },
    hermesServiceTokenConfigured: true,
    nowMs: Date.parse('2026-05-04T14:01:00.000Z')
  });

  assert.equal(status.state, 'degraded');
  assert.equal(status.label, 'Auth failing');
  assert.match(status.summary, /do not match/);
});

test('buildRecentAssistantTimingsTelemetry surfaces stored llama timings for the maintenance page', () => {
  const llamaTimingsJson = JSON.stringify({
    prompt_eval_count: 48,
    prompt_eval_duration: 125000000,
    eval_count: 96,
    eval_duration: 640000000,
    predicted_per_second: 150
  });

  const telemetry = buildRecentAssistantTimingsTelemetry(
    {
      total_count: 3,
      with_timings_count: 2,
      last_with_timings_at: '2026-05-04T14:03:00.000Z'
    },
    [
      {
        id: 'msg-1',
        conversation_id: 'conv-1',
        created_at: '2026-05-04T14:03:00.000Z',
        content: 'Most recent answer',
        timings: llamaTimingsJson
      },
      {
        id: 'msg-2',
        conversation_id: 'conv-1',
        created_at: '2026-05-04T14:02:00.000Z',
        content: 'Older answer',
        timings: { prompt_eval_count: 12, eval_count: 34 }
      },
      {
        id: 'msg-3',
        conversation_id: 'conv-2',
        created_at: '2026-05-04T14:01:00.000Z',
        content: 'No timings here',
        timings: null
      }
    ]
  );

  assert.equal(telemetry.ok, true);
  assert.equal(telemetry.totalAssistantCount, 3);
  assert.equal(telemetry.withTimingsCount, 2);
  assert.equal(telemetry.withoutTimingsCount, 1);
  assert.equal(telemetry.lastWithTimingsAt, '2026-05-04T14:03:00.000Z');
  assert.deepEqual(telemetry.recent[0].timings, JSON.parse(llamaTimingsJson));
  assert.equal(telemetry.recent[0].timingsRaw, llamaTimingsJson);
  assert.deepEqual(telemetry.recent[1].timings, { prompt_eval_count: 12, eval_count: 34 });
  assert.equal(telemetry.recent[1].timingsRaw, JSON.stringify({ prompt_eval_count: 12, eval_count: 34 }));
  assert.equal(telemetry.recent[2].timings, null);
  assert.equal(telemetry.recent[2].timingsRaw, null);
});