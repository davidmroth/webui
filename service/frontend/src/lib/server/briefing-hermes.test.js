import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HermesBriefingRegistrationError,
  registerBriefingFromHermes
} from './briefing-hermes.ts';

test('registerBriefingFromHermes upserts a conversation-owned briefing', async () => {
  let upserted = null;

  const result = await registerBriefingFromHermes(
    {
      jobId: 'job-42',
      conversationId: 'conversation-1',
      title: 'Morning briefing',
      summary: 'Today at a glance.',
      state: 'ready'
    },
    {
      getConversationOwnerIdFn: async () => 'user-1',
      getBriefingRecordFn: async () => null,
      queryFn: async () => {
        throw new Error('The user fallback should not run.');
      },
      upsertBriefingRecordFn: async (record) => {
        upserted = record;
        return record.jobId;
      }
    }
  );

  assert.equal(result.jobId, 'job-42');
  assert.equal(result.ownerUserId, 'user-1');
  assert.equal(result.conversationId, 'conversation-1');
  assert.equal(result.title, 'Morning briefing');
  assert.equal(result.summary, 'Today at a glance.');
  assert.equal(result.state, 'ready');
  assert.deepEqual(upserted, result);
});

test('registerBriefingFromHermes assigns a conversationless job to the sole user', async () => {
  const result = await registerBriefingFromHermes(
    { jobId: 'cron-job', state: 'unexpected' },
    {
      getBriefingRecordFn: async () => null,
      queryFn: async () => [{ id: 'sole-user' }],
      upsertBriefingRecordFn: async (record) => record.jobId
    }
  );

  assert.equal(result.ownerUserId, 'sole-user');
  assert.equal(result.conversationId, null);
  assert.equal(result.state, 'processing');
});

test('registerBriefingFromHermes does not regress an existing ready record', async () => {
  const existing = {
    jobId: 'job-ready',
    ownerUserId: 'user-1',
    conversationId: null,
    sourceMessageId: null,
    briefingId: 'briefing-ready',
    title: 'Published title',
    summary: 'Published summary',
    state: 'ready',
    stage: 'completed',
    progressPercent: 100,
    progressDetail: null,
    sentenceTotal: 10,
    sentenceCompleted: 10,
    manifestStorageKey: 'webui/briefings/job-ready/briefing.json',
    statusStorageKey: 'webui/briefings/job-ready/status.json',
    errorMessage: null,
    validationValid: true,
    validationWarningCount: 0,
    validationErrorCount: 0,
    createdAt: '2026-08-20T00:00:00Z',
    updatedAt: '2026-08-20T00:00:00Z',
    startedAt: '2026-08-20T00:00:00Z',
    completedAt: '2026-08-20T00:01:00Z',
    failedAt: null
  };

  const result = await registerBriefingFromHermes(
    {
      jobId: 'job-ready',
      conversationId: 'conversation-1',
      state: 'processing'
    },
    {
      getConversationOwnerIdFn: async () => 'user-1',
      getBriefingRecordFn: async () => existing,
      upsertBriefingRecordFn: async (record) => record.jobId
    }
  );

  assert.equal(result.state, 'ready');
  assert.equal(result.conversationId, 'conversation-1');
  assert.equal(result.title, 'Published title');
  assert.equal(result.manifestStorageKey, existing.manifestStorageKey);
});

test('registerBriefingFromHermes rejects an unknown conversation', async () => {
  await assert.rejects(
    () =>
      registerBriefingFromHermes(
        { jobId: 'job-404', conversationId: 'missing' },
        { getConversationOwnerIdFn: async () => null }
      ),
    (error) =>
      error instanceof HermesBriefingRegistrationError &&
      error.status === 404 &&
      error.code === 'BRIEFING_CONVERSATION_NOT_FOUND'
  );
});
