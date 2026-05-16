import test from 'node:test';
import assert from 'node:assert/strict';

import { listBriefingsForUser } from './briefing-list.ts';

test('listBriefingsForUser clamps oversized pages and maps briefing metadata', async () => {
  const result = await listBriefingsForUser('user-1', {
    page: 9,
    pageSize: 2,
    queryFn: async (sql, params) => {
      if (sql.includes('COUNT(DISTINCT')) {
        assert.equal(params?.user_id, 'user-1');
        return [{ total: 3 }];
      }

      assert.equal(params?.limit, 2);
      assert.equal(params?.offset, 2);
      return [
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
    queryFn: async (sql) => {
      if (sql.includes('COUNT(DISTINCT')) {
        return [{ total: 1 }];
      }

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