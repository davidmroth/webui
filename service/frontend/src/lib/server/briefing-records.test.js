import test from 'node:test';
import assert from 'node:assert/strict';

import {
	createBriefingVersion,
	getLatestBriefingVersion,
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
			progressPercent: 100,
			progressDetail: 'Publishing timed out.',
			sentenceTotal: 59,
			sentenceCompleted: 59,
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
	assert.equal(executeCalls[0].params.progress_percent, 100);
	assert.equal(executeCalls[0].params.sentence_total, 59);
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
				progress_percent: 100,
				progress_detail: 'Ready.',
				sentence_total: 59,
				sentence_completed: 59,
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
	assert.equal(record?.progressPercent, 100);
	assert.equal(record?.sentenceCompleted, 59);
	assert.equal(record?.validationWarningCount, 2);
	assert.equal(record?.manifestStorageKey, 'webui/briefings/job-9/briefing.json');
});

test('createBriefingVersion validates versioned canonical artifact writes', async () => {
	const executeCalls = [];
	const result = await createBriefingVersion(
		{
			jobId: 'job-100',
			versionNumber: 2,
			artifactSchemaVersion: 'briefing-document/v1',
			artifact: {
				schemaVersion: 'briefing-document/v1',
				jobId: 'job-100',
				briefingId: 'briefing-100',
				title: 'Rates Briefing',
				topic: 'Federal Reserve outlook',
				summary: 'Summary',
				generatedAt: '2026-05-22T08:00:00Z',
				locale: 'en-US',
				generatedBy: 'hermes',
				validation: { valid: true, warnings: [], errors: [] },
				assets: [],
				audioAsset: null,
				sections: [],
				sources: [],
				timelineCues: []
			},
			provenance: {
				schemaVersion: 'briefing-provenance/v1',
				originalPrompt: 'Create a macro briefing.',
				systemPrompt: 'System prompt',
				requestedChanges: ['Tighten the lead'],
				sourceSummary: 'Fed transcripts and CPI releases',
				sourceUrls: ['https://example.com/fed'],
				provider: 'openai',
				model: 'gpt-test',
				conversationId: 'conv-100',
				sourceMessageId: 'msg-100',
				toolName: 'regenerate_briefing',
				metadata: { tone: 'analytical' }
			},
			creationReason: 'regeneration',
			createdByProvider: 'openai',
			createdByModel: 'gpt-test'
		},
		{
			executeFn: async (sql, params = {}) => {
				executeCalls.push({ sql, params });
				return {};
			}
		}
	);

	assert.deepEqual(result, { jobId: 'job-100', versionNumber: 2 });
	assert.equal(executeCalls.length, 1);
	assert.match(executeCalls[0].sql, /INSERT INTO briefing_versions/);
	assert.equal(executeCalls[0].params.job_id, 'job-100');
	assert.equal(executeCalls[0].params.version_number, 2);
	assert.equal(executeCalls[0].params.creation_reason, 'regeneration');
	assert.match(executeCalls[0].params.artifact_json, /Federal Reserve outlook/);
	assert.match(executeCalls[0].params.provenance_json, /regenerate_briefing/);
});

test('getLatestBriefingVersion maps stored canonical artifact and provenance', async () => {
	const version = await getLatestBriefingVersion('job-101', {
		queryFn: async () => [
			{
				id: 7,
				job_id: 'job-101',
				version_number: 3,
				artifact_schema_version: 'briefing-document/v1',
				artifact_json: JSON.stringify({
					schemaVersion: 'briefing-document/v1',
					jobId: 'job-101',
					briefingId: 'briefing-101',
					title: 'Stored Briefing',
					topic: 'Policy recap',
					summary: 'Stored summary',
					generatedAt: '2026-05-22T08:05:00Z',
					locale: 'en-US',
					generatedBy: 'hermes',
					validation: { valid: true, warnings: [], errors: [] },
					assets: [],
					audioAsset: null,
					sections: [],
					sources: [],
					timelineCues: []
				}),
				provenance_json: JSON.stringify({
					schemaVersion: 'briefing-provenance/v1',
					originalPrompt: 'Original prompt',
					systemPrompt: null,
					requestedChanges: [],
					sourceSummary: null,
					sourceUrls: [],
					provider: 'openai',
					model: 'gpt-test',
					conversationId: 'conv-101',
					sourceMessageId: 'msg-101',
					toolName: null,
					metadata: { persona: 'briefing' }
				}),
				creation_reason: 'initial_generation',
				created_by_provider: 'openai',
				created_by_model: 'gpt-test',
				created_at: '2026-05-22T08:05:05Z'
			}
		]
	});

	assert.equal(version?.jobId, 'job-101');
	assert.equal(version?.versionNumber, 3);
	assert.equal(version?.artifact.topic, 'Policy recap');
	assert.equal(version?.provenance?.originalPrompt, 'Original prompt');
	assert.equal(version?.createdByModel, 'gpt-test');
});