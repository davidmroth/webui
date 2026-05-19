import test from 'node:test';
import assert from 'node:assert/strict';

import {
	getBriefingRecord,
	upsertBriefingAssets,
	upsertBriefingRecord
} from './briefing-records.ts';

test('upsertBriefingRecord validates required identifiers', async () => {
	await assert.rejects(
		() => upsertBriefingRecord({ jobId: '', ownerUserId: 'user-1' }),
		/jobId is required\./
	);
	await assert.rejects(
		() => upsertBriefingRecord({ jobId: 'job-1', ownerUserId: '' }),
		/ownerUserId is required\./
	);
});

test('upsertBriefingRecord writes canonical briefing metadata', async () => {
	const executeCalls = [];
	const jobId = await upsertBriefingRecord(
		{
			jobId: 'job-42',
			ownerUserId: 'user-42',
			conversationId: 'conv-42',
			briefingId: 'briefing-42',
			title: 'Canonical Briefing',
			summary: 'Summary',
			state: 'failed',
			stage: 'publishing_bundle',
			statusStorageKey: 'webui/briefings/job-42/status.json',
			errorMessage: 'Publishing timed out.',
			validationValid: true,
			validationWarningCount: 1,
			validationErrorCount: 0,
			failedAt: '2026-05-18T08:15:00Z'
		},
		{
			executeFn: async (sql, params = {}) => {
				executeCalls.push({ sql, params });
				return {};
			}
		}
	);

	assert.equal(jobId, 'job-42');
	assert.equal(executeCalls.length, 1);
	assert.match(executeCalls[0].sql, /INSERT INTO briefings/);
	assert.equal(executeCalls[0].params.job_id, 'job-42');
	assert.equal(executeCalls[0].params.owner_user_id, 'user-42');
	assert.equal(executeCalls[0].params.state, 'failed');
	assert.equal(executeCalls[0].params.validation_warning_count, 1);
	assert.equal(executeCalls[0].params.status_storage_key, 'webui/briefings/job-42/status.json');
});

test('upsertBriefingAssets upserts each asset row', async () => {
	const executeCalls = [];
	const count = await upsertBriefingAssets(
		'job-77',
		[
			{
				role: 'standalone_html',
				assetPath: 'standalone.html',
				storageKey: 'webui/briefings/job-77/standalone.html',
				contentType: 'text/html; charset=utf-8',
				sizeBytes: 1200
			},
			{
				role: 'audio',
				assetPath: 'audio.mp3',
				storageKey: 'webui/briefings/job-77/audio.mp3',
				contentType: 'audio/mpeg',
				sizeBytes: 2048
			}
		],
		{
			executeFn: async (sql, params = {}) => {
				executeCalls.push({ sql, params });
				return {};
			}
		}
	);

	assert.equal(count, 2);
	assert.equal(executeCalls.length, 2);
	assert.match(executeCalls[0].sql, /INSERT INTO briefing_assets/);
	assert.equal(executeCalls[0].params.job_id, 'job-77');
	assert.equal(executeCalls[1].params.asset_path, 'audio.mp3');
});

test('getBriefingRecord maps canonical briefing rows', async () => {
	const record = await getBriefingRecord('job-9', {
		queryFn: async () => [
			{
				job_id: 'job-9',
				owner_user_id: 'user-9',
				conversation_id: 'conv-9',
				source_message_id: null,
				briefing_id: 'briefing-9',
				title: 'Stored Briefing',
				summary: 'Stored summary',
				state: 'ready',
				stage: 'completed',
				manifest_storage_key: 'webui/briefings/job-9/briefing.json',
				status_storage_key: 'webui/briefings/job-9/status.json',
				error_message: null,
				validation_valid: 1,
				validation_warning_count: 2,
				validation_error_count: 0,
				created_at: '2026-05-18T08:00:00Z',
				updated_at: '2026-05-18T08:01:00Z',
				started_at: '2026-05-18T08:00:05Z',
				completed_at: '2026-05-18T08:01:00Z',
				failed_at: null
			}
		]
	});

	assert.equal(record?.jobId, 'job-9');
	assert.equal(record?.ownerUserId, 'user-9');
	assert.equal(record?.state, 'ready');
	assert.equal(record?.validationWarningCount, 2);
	assert.equal(record?.manifestStorageKey, 'webui/briefings/job-9/briefing.json');
});