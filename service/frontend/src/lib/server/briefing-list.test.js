import test from 'node:test';
import assert from 'node:assert/strict';

import { deleteBriefingForUser, listBriefingsForUser } from './briefing-list.ts';

test('listBriefingsForUser clamps oversized pages and maps briefing metadata', async () => {
  const result = await listBriefingsForUser('user-1', {
    page: 9,
    pageSize: 2,
    listObjectKeysFn: async () => [],
    queryFn: async (sql, params) => {
      assert.equal(params?.user_id, 'user-1');
      return [
        {
          job_id: 'job-1',
          briefing_id: 'briefing-1',
          title: 'Morning Pulse',
          summary: null,
          state: 'ready',
          validation_valid: 1,
          validation_warning_count: 0,
          validation_error_count: 0,
          conversation_id: 'conv-3',
          conversation_title: 'Morning briefing',
          sort_at: '2026-05-16 12:00:00',
          created_at: '2026-05-16 12:00:00',
          updated_at: '2026-05-16 12:00:00',
          started_at: '2026-05-16 12:00:00',
          completed_at: '2026-05-16 12:00:00',
          failed_at: null,
          is_public: 0
        },
        {
          job_id: 'job-2',
          briefing_id: 'briefing-2',
          title: 'Afternoon Pulse',
          summary: null,
          state: 'ready',
          validation_valid: 1,
          validation_warning_count: 0,
          validation_error_count: 0,
          conversation_id: 'conv-2',
          conversation_title: 'Afternoon briefing',
          sort_at: '2026-05-16 11:00:00',
          created_at: '2026-05-16 11:00:00',
          updated_at: '2026-05-16 11:00:00',
          started_at: '2026-05-16 11:00:00',
          completed_at: '2026-05-16 11:00:00',
          failed_at: null,
          is_public: 0
        },
        {
          job_id: 'job-3',
          briefing_id: 'briefing-3',
          title: 'Q2 Market Update',
          summary: 'Revenue, margin, and exposure shifts.',
          state: 'ready',
          validation_valid: 1,
          validation_warning_count: 1,
          validation_error_count: 0,
          conversation_id: 'conv-1',
          conversation_title: 'Daily briefing',
          sort_at: '2026-05-16 10:00:00',
          created_at: '2026-05-16 10:00:00',
          updated_at: '2026-05-16 10:00:00',
          started_at: '2026-05-16 10:00:00',
          completed_at: '2026-05-16 10:00:00',
          failed_at: null,
          is_public: 1,
        }
      ];
    }
  });

  assert.equal(result.page, 2);
  assert.equal(result.pageSize, 2);
  assert.equal(result.total, 3);
  assert.equal(result.totalPages, 2);
  assert.equal(result.hasPreviousPage, true);
  assert.equal(result.hasNextPage, false);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].conversationId, 'conv-1');
  assert.equal(result.items[0].reference.jobId, 'job-3');
  assert.equal(result.items[0].reference.validation.warningCount, 1);
  assert.equal(result.items[0].isPublic, true);
});

test('listBriefingsForUser derives default briefing urls when references omit them', async () => {
  const result = await listBriefingsForUser('user-2', {
    listObjectKeysFn: async () => [],
    queryFn: async (sql) => {
      return [
        {
          job_id: 'job-42',
          briefing_id: 'briefing-42',
          title: 'Operations Snapshot',
          summary: null,
          state: 'failed',
          validation_valid: 0,
          validation_warning_count: 0,
          validation_error_count: 2,
          conversation_id: 'conv-2',
          conversation_title: 'Ops briefing',
          sort_at: '2026-05-16 11:00:00',
          created_at: '2026-05-16 11:00:00',
          updated_at: '2026-05-16 11:05:00',
          started_at: '2026-05-16 11:00:00',
          completed_at: null,
          failed_at: '2026-05-16 11:05:00',
          is_public: 0,
        }
      ];
    }
  });

  assert.equal(result.items[0].reference.previewUrl, '/briefings/job-42/player');
  assert.equal(result.items[0].reference.standaloneHtmlUrl, '/briefings/job-42');
  assert.equal(result.items[0].reference.validation.valid, false);
  assert.equal(result.items[0].isPublic, false);
  assert.equal(result.items[0].state, 'failed');
});

test('listBriefingsForUser syncs storage-backed jobs into the canonical table', async () => {
	const records = new Map();
  const result = await listBriefingsForUser('user-3', {
    listObjectKeysFn: async () => [
      'webui/briefings/job-storage-2/briefing.json',
      'webui/briefings/job-storage-2/status.json'
    ],
    readObjectBufferFn: async (storageKey) => {
      return Buffer.from(
        JSON.stringify({
          job_id: 'job-storage-2',
          briefing_id: 'briefing-storage-2',
          title: 'Stored Two',
          summary: 'From sync.',
          generated_at: '2026-05-11T10:00:00Z',
          sections: [],
          assets: [],
          timeline_cues: [],
          sources: [],
          validation: { valid: false, warnings: ['warn'], errors: ['err'] }
        })
      );
    },
    queryFn: async (sql, params = {}) => {
			if (sql.includes('SELECT owner_user_id') && sql.includes('FROM briefing_shares')) {
				return [];
			}
			if (sql.includes('SELECT id FROM users')) {
				return [{ id: 'user-3' }];
			}
			if (sql.includes('FROM briefings') && sql.includes('WHERE job_id = :job_id')) {
				const record = records.get(params.job_id);
				return record ? [record] : [];
			}
			if (sql.includes('WHERE briefings.owner_user_id = :user_id')) {
				return Array.from(records.values()).map((record) => ({
					job_id: record.job_id,
					briefing_id: record.briefing_id,
					title: record.title,
					summary: record.summary,
					state: record.state,
					validation_valid: record.validation_valid,
					validation_warning_count: record.validation_warning_count,
					validation_error_count: record.validation_error_count,
					conversation_id: record.conversation_id,
					conversation_title: null,
					sort_at: record.completed_at,
					created_at: record.created_at,
					updated_at: record.updated_at,
					started_at: record.started_at,
					completed_at: record.completed_at,
					failed_at: record.failed_at,
					is_public: 0
				}));
      }

      return [];
    },
		executeFn: async (sql, params = {}) => {
			if (sql.includes('INSERT INTO briefings')) {
				records.set(params.job_id, {
					job_id: params.job_id,
					owner_user_id: params.owner_user_id,
					conversation_id: params.conversation_id ?? null,
					source_message_id: params.source_message_id ?? null,
					briefing_id: params.briefing_id,
					title: params.title,
					summary: params.summary,
					state: params.state,
					validation_valid: params.validation_valid,
					validation_warning_count: params.validation_warning_count,
					validation_error_count: params.validation_error_count,
					created_at: params.started_at ?? '2026-05-11T10:00:00Z',
					updated_at: params.completed_at ?? '2026-05-11T10:00:00Z',
					started_at: params.started_at ?? null,
					completed_at: params.completed_at ?? null,
					failed_at: params.failed_at ?? null
				});
			}
			return {};
    }
  });

  assert.equal(result.total, 1);
  assert.equal(result.items[0].reference.jobId, 'job-storage-2');
  assert.equal(result.items[0].reference.validation.errorCount, 1);
  assert.equal(result.items[0].state, 'ready');
  assert.equal(records.get('job-storage-2').owner_user_id, 'user-3');
});

test('listBriefingsForUser keeps manifest-backed jobs failed when status reports publish timeout', async () => {
  const records = new Map();
  const result = await listBriefingsForUser('user-8', {
    listObjectKeysFn: async () => [
      'webui/briefings/job-publish-failed/briefing.json',
      'webui/briefings/job-publish-failed/status.json'
    ],
    readObjectBufferFn: async (storageKey) => {
      if (storageKey.endsWith('/briefing.json')) {
        return Buffer.from(
          JSON.stringify({
            job_id: 'job-publish-failed',
            briefing_id: 'ev-charger-market-analysis-2026-comprehensive-industry-report-20260517-052440',
            title: 'Ev Charger Market Analysis 2026 Comprehensive Industry Report 20260517 052440',
            summary: 'Stored manifest exists.',
            generated_at: '2026-05-17T05:24:40Z',
            assets: [],
            validation: { valid: true, warnings: [], errors: [] }
          })
        );
      }

      return Buffer.from(
        JSON.stringify({
          job_id: 'job-publish-failed',
          briefing_id: 'ev-charger-market-analysis-2026-comprehensive-industry-report-20260517-052440',
          status: 'completed',
          stage: 'completed',
          created_at: '2026-05-17T05:24:40+00:00',
          completed_at: '2026-05-17T05:54:29+00:00',
          validation: {
            valid: true,
            warnings: ['External object-storage publishing timed out. Renderer-hosted briefing assets remain available.'],
            errors: []
          }
        })
      );
    },
    queryFn: async (sql, params = {}) => {
      if (sql.includes('SELECT owner_user_id') && sql.includes('FROM briefing_shares')) {
        return [];
      }
      if (sql.includes('SELECT id FROM users')) {
        return [{ id: 'user-8' }];
      }
      if (sql.includes('FROM briefings') && sql.includes('WHERE job_id = :job_id')) {
        const record = records.get(params.job_id);
        return record ? [record] : [];
      }
      if (sql.includes('WHERE briefings.owner_user_id = :user_id')) {
        return Array.from(records.values()).map((record) => ({
          job_id: record.job_id,
          briefing_id: record.briefing_id,
          title: record.title,
          summary: record.summary,
          state: record.state,
          validation_valid: record.validation_valid,
          validation_warning_count: record.validation_warning_count,
          validation_error_count: record.validation_error_count,
          conversation_id: record.conversation_id,
          conversation_title: 'Archived briefing',
          sort_at: record.completed_at,
          created_at: record.created_at,
          updated_at: record.updated_at,
          started_at: record.started_at,
          completed_at: record.completed_at,
          failed_at: record.failed_at,
          is_public: 0
        }));
      }

      return [];
    },
    executeFn: async (sql, params = {}) => {
      if (sql.includes('INSERT INTO briefings')) {
        records.set(params.job_id, {
          job_id: params.job_id,
          owner_user_id: params.owner_user_id,
          conversation_id: params.conversation_id ?? null,
          source_message_id: params.source_message_id ?? null,
          briefing_id: params.briefing_id,
          title: params.title,
          summary: params.summary,
          state: params.state,
          validation_valid: params.validation_valid,
          validation_warning_count: params.validation_warning_count,
          validation_error_count: params.validation_error_count,
          created_at: params.started_at ?? '2026-05-17T05:24:40Z',
          updated_at: params.completed_at ?? '2026-05-17T05:54:29Z',
          started_at: params.started_at ?? null,
          completed_at: params.completed_at ?? null,
          failed_at: params.failed_at ?? null
        });
      }
      return {};
    }
  });

  assert.equal(result.total, 1);
  assert.equal(result.items[0].reference.jobId, 'job-publish-failed');
  assert.equal(result.items[0].state, 'failed');
  assert.equal(result.items[0].reference.validation.warningCount, 1);
  assert.equal(records.get('job-publish-failed').state, 'failed');
});

test('deleteBriefingForUser removes stored briefing objects and share state', async () => {
  const deletedKeys = [];
  const executeCalls = [];

  await deleteBriefingForUser('user-7', 'job-delete-1', {
    queryFn: async (sql) => {
      if (sql.includes('FROM briefing_shares')) {
        return [{ job_id: 'job-delete-1', owner_user_id: 'user-7', is_public: 1 }];
      }

      return [];
    },
    listObjectKeysFn: async (prefix) => {
      assert.match(prefix, /job-delete-1$/);
      return [
        'webui/briefings/job-delete-1/briefing.json',
        'webui/briefings/job-delete-1/audio.mp3'
      ];
    },
    deleteObjectKeysFn: async (storageKeys) => {
      deletedKeys.push(...storageKeys);
    },
    executeFn: async (sql, params) => {
      executeCalls.push({ sql, params });
      return {};
    }
  });

  assert.deepEqual(deletedKeys, [
    'webui/briefings/job-delete-1/briefing.json',
    'webui/briefings/job-delete-1/audio.mp3'
  ]);
  assert.equal(executeCalls.length, 2);
  assert.equal(executeCalls[0].params.job_id, 'job-delete-1');
  assert.equal(executeCalls[1].params.job_id, 'job-delete-1');
});