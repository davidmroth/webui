import test from 'node:test';
import assert from 'node:assert/strict';

import {
	findBriefingOwnerUserId,
	getBriefingShareState,
	getBriefingViewerAccess,
	setBriefingPublicState
} from './briefing-sharing.ts';

test('getBriefingViewerAccess allows unauthenticated viewers when the briefing is public', async () => {
	const access = await getBriefingViewerAccess('job-42', null, {
		queryFn: async (sql) => {
			if (sql.includes('FROM briefing_shares')) {
				return [{ job_id: 'job-42', owner_user_id: 'user-1', is_public: 1 }];
			}
			return [];
		}
	});

	assert.deepEqual(access, {
		jobId: 'job-42',
		ownerUserId: 'user-1',
		isPublic: true,
		canView: true,
		canManage: false
	});
});

test('getBriefingViewerAccess allows the owner to view and manage a private briefing', async () => {
	const access = await getBriefingViewerAccess('job-42', 'user-1', {
		queryFn: async (sql) => {
			if (sql.includes('FROM briefing_shares')) {
				return [{ job_id: 'job-42', owner_user_id: 'user-1', is_public: 0 }];
			}
			return [];
		}
	});

	assert.equal(access.canView, true);
	assert.equal(access.canManage, true);
	assert.equal(access.isPublic, false);
});

test('getBriefingViewerAccess allows any authenticated viewer to open a private legacy briefing', async () => {
	const access = await getBriefingViewerAccess('job-42', 'user-9', {
		queryFn: async (sql) => {
			if (sql.includes('FROM briefing_shares')) {
				return [];
			}
			if (sql.includes('FROM briefings')) {
				return [];
			}
			return [];
		}
	});

	assert.equal(access.canView, true);
	assert.equal(access.canManage, true);
	assert.equal(access.ownerUserId, null);
	assert.equal(access.isPublic, false);
});

test('getBriefingShareState falls back to the briefing reference owner when no share row exists yet', async () => {
	const share = await getBriefingShareState('job-42', {
		queryFn: async (sql) => {
			if (sql.includes('FROM briefing_shares')) {
				return [];
			}
			if (sql.includes('FROM briefings')) {
				return [{ owner_user_id: 'user-9' }];
			}
			return [];
		}
	});

	assert.deepEqual(share, {
		jobId: 'job-42',
		ownerUserId: 'user-9',
		isPublic: false
	});
});

test('findBriefingOwnerUserId returns null for empty job ids', async () => {
	assert.equal(await findBriefingOwnerUserId('   '), null);
});

test('setBriefingPublicState rejects non-owners', async () => {
	await assert.rejects(
		() =>
			setBriefingPublicState('job-42', 'user-2', true, {
				queryFn: async (sql) => {
					if (sql.includes('FROM briefing_shares')) {
						return [{ job_id: 'job-42', owner_user_id: 'user-1', is_public: 0 }];
					}
					return [];
				}
			}),
		/Only the briefing owner can change sharing/ 
	);
});

test('setBriefingPublicState upserts the public state for the owner', async () => {
	const calls = [];
	const state = await setBriefingPublicState('job-42', 'user-1', true, {
		queryFn: async (sql) => {
			if (sql.includes('FROM briefing_shares')) {
				return [];
			}
			if (sql.includes('FROM briefings')) {
				return [{ owner_user_id: 'user-1' }];
			}
			return [];
		},
		executeFn: async (sql, params) => {
			calls.push({ sql, params });
			return {};
		}
	});

	assert.deepEqual(state, {
		jobId: 'job-42',
		ownerUserId: 'user-1',
		isPublic: true
	});
	assert.equal(calls.length, 1);
	assert.equal(calls[0].params.is_public, 1);
});

test('setBriefingPublicState lets an authenticated viewer claim legacy briefings with no stored owner', async () => {
	const calls = [];
	const state = await setBriefingPublicState('job-42', 'user-7', true, {
		queryFn: async () => [],
		executeFn: async (sql, params) => {
			calls.push({ sql, params });
			return {};
		}
	});

	assert.deepEqual(state, {
		jobId: 'job-42',
		ownerUserId: 'user-7',
		isPublic: true
	});
	assert.equal(calls.length, 1);
	assert.equal(calls[0].params.owner_user_id, 'user-7');
});