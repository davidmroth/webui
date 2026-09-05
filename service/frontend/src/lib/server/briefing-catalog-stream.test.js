import assert from 'node:assert/strict';
import test from 'node:test';

import {
  publishBriefingCatalogEvent,
  subscribeBriefingCatalog
} from './briefing-catalog-stream.ts';

test('briefing catalog events are scoped to the owner and can unsubscribe', () => {
  const received = [];
  const unsubscribe = subscribeBriefingCatalog('user-1', (event) => {
    received.push(event.jobId);
  });

  publishBriefingCatalogEvent({ ownerUserId: 'user-2', jobId: 'other-job' });
  publishBriefingCatalogEvent({ ownerUserId: 'user-1', jobId: 'owned-job' });
  unsubscribe();
  publishBriefingCatalogEvent({ ownerUserId: 'user-1', jobId: 'late-job' });

  assert.deepEqual(received, ['owned-job']);
});
