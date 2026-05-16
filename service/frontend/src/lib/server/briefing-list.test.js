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
          conversation_id: 'conv-3',
          conversation_title: 'Morning briefing',
          sort_at: '2026-05-16 12:00:00',
          is_public: 0,
          extra: JSON.stringify({
            briefingReference: {
              jobId: 'job-1',
              briefingId: 'briefing-1',
              title: 'Morning Pulse',
              generatedAt: '2026-05-16T12:00:00Z',
              validation: {
                valid: true,
                warningCount: 0,
                errorCount: 0
              }
            }
          })
        },
        {
          conversation_id: 'conv-2',
          conversation_title: 'Afternoon briefing',
          sort_at: '2026-05-16 11:00:00',
          is_public: 0,
          extra: JSON.stringify({
            briefingReference: {
              jobId: 'job-2',
              briefingId: 'briefing-2',
              title: 'Afternoon Pulse',
              generatedAt: '2026-05-16T11:00:00Z',
              validation: {
                valid: true,
                warningCount: 0,
                errorCount: 0
              }
            }
          })
        },
        {
          conversation_id: 'conv-1',
          conversation_title: 'Daily briefing',
          sort_at: '2026-05-16 10:00:00',
          is_public: 1,
          extra: JSON.stringify({
            briefingReference: {
              jobId: 'job-3',
              briefingId: 'briefing-3',
              title: 'Q2 Market Update',
              summary: 'Revenue, margin, and exposure shifts.',
              generatedAt: '2026-05-16T10:00:00Z',
              previewUrl: '/briefings/job-3/player',
              standaloneHtmlUrl: '/briefings/job-3',
              validation: {
                valid: true,
                warningCount: 1,
                errorCount: 0
              }
            }
          })
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
          conversation_id: 'conv-2',
          conversation_title: 'Ops briefing',
          sort_at: '2026-05-16 11:00:00',
          is_public: 0,
          extra: {
            briefingReference: {
              jobId: 'job-42',
              briefingId: 'briefing-42',
              title: 'Operations Snapshot',
              validation: {
                valid: false,
                warningCount: 0,
                errorCount: 2
              }
            }
          }
        }
      ];
    }
  });

  assert.equal(result.items[0].reference.previewUrl, '/briefings/job-42/player');
  assert.equal(result.items[0].reference.standaloneHtmlUrl, '/briefings/job-42');
  assert.equal(result.items[0].reference.validation.valid, false);
  assert.equal(result.items[0].isPublic, false);
});

test('listBriefingsForUser falls back to stored briefing manifests when chat metadata is missing', async () => {
  const result = await listBriefingsForUser('user-3', {
    listObjectKeysFn: async () => [
      'webui/briefings/job-storage-2/briefing.json',
      'webui/briefings/job-storage-1/briefing.json',
      'webui/briefings/job-storage-1/audio.mp3'
    ],
    readObjectBufferFn: async (storageKey) => {
      if (storageKey.endsWith('job-storage-1/briefing.json')) {
        return Buffer.from(
          JSON.stringify({
            job_id: 'job-storage-1',
            briefing_id: 'briefing-storage-1',
            title: 'Stored One',
            summary: 'From object storage.',
            generated_at: '2026-05-10T10:00:00Z',
            sections: [],
            assets: [],
            timeline_cues: [],
            sources: [],
            validation: { valid: true, warnings: [], errors: [] }
          })
        );
      }

      return Buffer.from(
        JSON.stringify({
          job_id: 'job-storage-2',
          briefing_id: 'briefing-storage-2',
          title: 'Stored Two',
          generated_at: '2026-05-11T10:00:00Z',
          sections: [],
          assets: [],
          timeline_cues: [],
          sources: [],
          validation: { valid: false, warnings: ['warn'], errors: ['err'] }
        })
      );
    },
    queryFn: async (sql) => {
      if (sql.includes('FROM users')) {
        return [{ total: 1 }];
      }

      return [];
    }
  });

  assert.equal(result.total, 2);
  assert.equal(result.items[0].reference.jobId, 'job-storage-2');
  assert.equal(result.items[1].reference.jobId, 'job-storage-1');
  assert.equal(result.items[0].reference.validation.errorCount, 1);
  assert.equal(result.items[1].conversationId, null);
});

test('listBriefingsForUser keeps db-backed briefings that are still waiting on storage manifests', async () => {
  const result = await listBriefingsForUser('user-4', {
    listObjectKeysFn: async () => ['webui/briefings/job-storage-1/briefing.json'],
    readObjectBufferFn: async () =>
      Buffer.from(
        JSON.stringify({
          job_id: 'job-storage-1',
          briefing_id: 'briefing-storage-1',
          title: 'Stored One',
          generated_at: '2026-05-10T10:00:00Z',
          sections: [],
          assets: [],
          timeline_cues: [],
          sources: [],
          validation: { valid: true, warnings: [], errors: [] }
        })
      ),
    queryFn: async (sql, params) => {
      if (sql.includes('FROM users')) {
        return [{ total: 1 }];
      }

      if (sql.includes('FROM briefing_shares')) {
        return [];
      }

      assert.equal(params?.user_id, 'user-4');
      return [
        {
          conversation_id: 'conv-storage',
          conversation_title: 'Stored briefing conversation',
          sort_at: '2026-05-10 10:00:00',
          is_public: 0,
          extra: JSON.stringify({
            briefingReference: {
              jobId: 'job-storage-1',
              briefingId: 'briefing-storage-1',
              title: 'Stored One',
              generatedAt: '2026-05-10T10:00:00Z',
              validation: {
                valid: true,
                warningCount: 0,
                errorCount: 0
              }
            }
          })
        },
        {
          conversation_id: 'conv-pending',
          conversation_title: 'Pending publish conversation',
          sort_at: '2026-05-16 12:00:00',
          is_public: 0,
          extra: JSON.stringify({
            briefingReference: {
              jobId: 'job-pending-1',
              briefingId: 'briefing-pending-1',
              title: 'Pending Publish',
              generatedAt: '2026-05-16T12:00:00Z',
              previewUrl: '/briefings/job-pending-1/player',
              standaloneHtmlUrl: '/briefings/job-pending-1',
              validation: {
                valid: true,
                warningCount: 1,
                errorCount: 0
              }
            }
          })
        }
      ];
    }
  });

  assert.equal(result.total, 2);
  assert.equal(result.items[0].reference.jobId, 'job-pending-1');
  assert.equal(result.items[0].conversationId, 'conv-pending');
  assert.equal(result.items[1].reference.jobId, 'job-storage-1');
});

test('listBriefingsForUser includes status-only renderer jobs so the archive matches recent API jobs', async () => {
  const result = await listBriefingsForUser('user-5', {
    listObjectKeysFn: async () => [
      'webui/briefings/job-status-only/status.json',
      'webui/briefings/job-storage-1/briefing.json'
    ],
    readObjectBufferFn: async (storageKey) => {
      if (storageKey.endsWith('job-status-only/status.json')) {
        return Buffer.from(
          JSON.stringify({
            job_id: 'job-status-only',
            briefing_id: 'iran-war-day-78-ceasefire-talks-stall-military-escalation-looms-20260516-192734',
            status: 'completed',
            stage: 'completed',
            created_at: '2026-05-16T19:27:34+00:00',
            completed_at: '2026-05-16T19:34:32+00:00',
            validation: {
              valid: true,
              warnings: ['External object-storage publishing timed out. Renderer-hosted briefing assets remain available.'],
              errors: []
            }
          })
        );
      }

      return Buffer.from(
        JSON.stringify({
          job_id: 'job-storage-1',
          briefing_id: 'briefing-storage-1',
          title: 'Stored One',
          generated_at: '2026-05-10T10:00:00Z',
          sections: [],
          assets: [],
          timeline_cues: [],
          sources: [],
          validation: { valid: true, warnings: [], errors: [] }
        })
      );
    },
    queryFn: async (sql) => {
      if (sql.includes('FROM users')) {
        return [{ total: 1 }];
      }

      if (sql.includes('FROM briefing_shares')) {
        return [];
      }

      return [];
    }
  });

  assert.equal(result.total, 2);
  assert.equal(result.items[0].reference.jobId, 'job-status-only');
  assert.match(result.items[0].reference.title, /Iran War Day 78/i);
  assert.equal(result.items[0].reference.validation.warningCount, 1);
  assert.equal(result.items[1].reference.jobId, 'job-storage-1');
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
  assert.equal(executeCalls.length, 1);
  assert.equal(executeCalls[0].params.job_id, 'job-delete-1');
});