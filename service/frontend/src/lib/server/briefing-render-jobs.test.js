import test from 'node:test';
import assert from 'node:assert/strict';

import {
	claimNextBriefingRenderJob,
	completeBriefingRenderJob,
	enqueueBriefingRerender,
	failBriefingRenderJob,
	getLatestBriefingRenderJob,
	markBriefingRenderJobProgress
} from './briefing-render-jobs.ts';

test('enqueueBriefingRerender queues a render job for the latest briefing version', async () => {
	const executeCalls = [];
	const queued = await enqueueBriefingRerender('job-1', 'user-1', {
		randomIdFn: () => 'render-job-1',
		getBriefingRecordFn: async () => ({
			jobId: 'job-1',
			ownerUserId: 'user-1',
			conversationId: 'conv-1',
			sourceMessageId: 'msg-1',
			briefingId: 'briefing-1',
			title: 'Title',
			summary: 'Summary',
			state: 'ready',
			stage: 'completed',
			manifestStorageKey: null,
			statusStorageKey: null,
			errorMessage: null,
			validationValid: true,
			validationWarningCount: 0,
			validationErrorCount: 0,
			createdAt: '2026-05-22T00:00:00Z',
			updatedAt: '2026-05-22T00:00:00Z',
			startedAt: '2026-05-22T00:00:00Z',
			completedAt: '2026-05-22T00:00:05Z',
			failedAt: null
		}),
		getLatestBriefingVersionFn: async () => ({
			id: 1,
			jobId: 'job-1',
			versionNumber: 3,
			artifactSchemaVersion: 'briefing-document/v1',
			artifact: {
				schemaVersion: 'briefing-document/v1',
				jobId: 'job-1',
				briefingId: 'briefing-1',
				title: 'Title',
				topic: 'Topic',
				summary: 'Summary',
				generatedAt: '2026-05-22T00:00:00Z',
				locale: 'en-US',
				generatedBy: 'hermes',
				validation: { valid: true, warnings: [], errors: [] },
				assets: [],
				audioAsset: null,
				sections: [],
				sources: [],
				timelineCues: []
			},
			provenance: null,
			creationReason: 'initial_generation',
			createdByProvider: 'openai',
			createdByModel: 'gpt-test',
			createdAt: '2026-05-22T00:00:00Z'
		}),
		executeFn: async (sql, params) => {
			executeCalls.push({ sql, params });
			return { affectedRows: 1 };
		}
	});

	assert.deepEqual(queued, { renderJobId: 'render-job-1', jobId: 'job-1', versionNumber: 3 });
	assert.equal(executeCalls.length, 3);
	assert.equal(executeCalls[0].params.job_id, 'job-1');
	assert.equal(executeCalls[1].params.id, 'render-job-1');
	assert.equal(executeCalls[2].params.job_id, 'job-1');
});

test('enqueueBriefingRerender cancels older queued or processing jobs for the same briefing', async () => {
	const executeCalls = [];
	await enqueueBriefingRerender('job-restart', 'user-1', {
		randomIdFn: () => 'render-job-restart',
		getBriefingRecordFn: async () => ({
			jobId: 'job-restart',
			ownerUserId: 'user-1',
			conversationId: 'conv-1',
			sourceMessageId: 'msg-1',
			briefingId: 'briefing-1',
			title: 'Title',
			summary: 'Summary',
			state: 'processing',
			stage: 'queued',
			manifestStorageKey: null,
			statusStorageKey: null,
			errorMessage: null,
			validationValid: true,
			validationWarningCount: 0,
			validationErrorCount: 0,
			createdAt: '2026-05-22T00:00:00Z',
			updatedAt: '2026-05-22T00:00:00Z',
			startedAt: '2026-05-22T00:00:00Z',
			completedAt: null,
			failedAt: null
		}),
		getLatestBriefingVersionFn: async () => ({
			id: 1,
			jobId: 'job-restart',
			versionNumber: 3,
			artifactSchemaVersion: 'briefing-document/v1',
			artifact: {
				schemaVersion: 'briefing-document/v1',
				jobId: 'job-restart',
				briefingId: 'briefing-1',
				title: 'Title',
				topic: 'Topic',
				summary: 'Summary',
				generatedAt: '2026-05-22T00:00:00Z',
				locale: 'en-US',
				generatedBy: 'hermes',
				validation: { valid: true, warnings: [], errors: [] },
				assets: [],
				audioAsset: null,
				sections: [],
				sources: [],
				timelineCues: []
			},
			provenance: null,
			creationReason: 'initial_generation',
			createdByProvider: 'openai',
			createdByModel: 'gpt-test',
			createdAt: '2026-05-22T00:00:00Z'
		}),
		executeFn: async (sql, params) => {
			executeCalls.push({ sql, params });
			return { affectedRows: 1 };
		}
	});

	assert.match(executeCalls[0].sql, /SET status = 'cancelled'/);
	assert.equal(executeCalls[0].params.job_id, 'job-restart');
});

test('enqueueBriefingRerender imports a legacy published briefing when no canonical version exists', async () => {
	const executeCalls = [];
	const createVersionCalls = [];
	const queued = await enqueueBriefingRerender('job-legacy', 'user-1', {
		randomIdFn: () => 'render-job-legacy',
		getBriefingRecordFn: async () => ({
			jobId: 'job-legacy',
			ownerUserId: 'user-1',
			conversationId: 'conv-1',
			sourceMessageId: 'msg-1',
			briefingId: 'briefing-legacy',
			title: 'Legacy title',
			summary: 'Legacy summary',
			state: 'processing',
			stage: 'completed',
			manifestStorageKey: 'briefings/job-legacy/briefing.json',
			statusStorageKey: 'briefings/job-legacy/status.json',
			errorMessage: null,
			validationValid: true,
			validationWarningCount: 0,
			validationErrorCount: 0,
			createdAt: '2026-05-22T00:00:00Z',
			updatedAt: '2026-05-22T00:00:00Z',
			startedAt: '2026-05-22T00:00:00Z',
			completedAt: null,
			failedAt: null
		}),
		getLatestBriefingVersionFn: async () => null,
		loadPublishedCanonicalArtifactFn: async () => ({
			schemaVersion: 'briefing-document/v1',
			jobId: 'job-legacy',
			briefingId: 'briefing-legacy',
			title: 'Legacy title',
			topic: 'Legacy topic',
			summary: 'Legacy summary',
			generatedAt: '2026-05-22T00:00:05Z',
			locale: 'en-US',
			generatedBy: 'hermes',
			validation: { valid: true, warnings: [], errors: [] },
			assets: [],
			audioAsset: null,
			sections: [],
			sources: [],
			timelineCues: []
		}),
		createBriefingVersionFn: async (input) => {
			createVersionCalls.push(input);
			return { jobId: input.jobId, versionNumber: input.versionNumber };
		},
		executeFn: async (sql, params) => {
			executeCalls.push({ sql, params });
			return { affectedRows: 1 };
		}
	});

	assert.deepEqual(queued, { renderJobId: 'render-job-legacy', jobId: 'job-legacy', versionNumber: 1 });
	assert.equal(createVersionCalls.length, 1);
	assert.equal(createVersionCalls[0].creationReason, 'legacy_import');
	assert.equal(createVersionCalls[0].versionNumber, 1);
	assert.equal(executeCalls.length, 3);
	assert.equal(executeCalls[1].params.briefing_version_number, 1);
});

test('markBriefingRenderJobProgress ignores cancelled render jobs', async () => {
	const progress = await markBriefingRenderJobProgress('render-job-cancelled', 'encoding_audio', {
		percent: 58
	}, {
		queryFn: async () => [
			{
				id: 'render-job-cancelled',
				job_id: 'job-1',
				briefing_version_number: 2,
				requested_by_user_id: 'user-1',
				status: 'cancelled',
				error_message: 'Superseded',
				created_at: '2026-05-22T00:00:00Z',
				claimed_at: '2026-05-22T00:00:05Z',
				completed_at: '2026-05-22T00:00:06Z'
			}
		],
		executeFn: async () => {
			throw new Error('Cancelled jobs should not update progress.');
		}
	});

	assert.equal(progress, null);
});

test('getLatestBriefingRenderJob maps queue rows', async () => {
	const result = await getLatestBriefingRenderJob('job-9', {
		queryFn: async () => [
			{
				id: 'render-job-9',
				job_id: 'job-9',
				briefing_version_number: 4,
				requested_by_user_id: 'user-9',
				status: 'processing',
				error_message: null,
				created_at: '2026-05-22T01:00:00Z',
				claimed_at: '2026-05-22T01:00:05Z',
				completed_at: null
			}
		]
	});

	assert.equal(result?.id, 'render-job-9');
	assert.equal(result?.status, 'processing');
	assert.equal(result?.briefingVersionNumber, 4);
});

test('claimNextBriefingRenderJob claims the oldest queued job and returns the canonical artifact', async () => {
	const executeCalls = [];
	const claimed = await claimNextBriefingRenderJob({
		queryFn: async (sql) => {
			if (/WHERE status = 'queued'/.test(sql)) {
				return [
					{
						id: 'render-job-1',
						job_id: 'job-1',
						briefing_version_number: 2,
						requested_by_user_id: 'user-1',
						status: 'queued',
						error_message: null,
						created_at: '2026-05-22T00:00:00Z',
						claimed_at: null,
						completed_at: null
					}
				];
			}
			return [];
		},
		executeFn: async (sql, params) => {
			executeCalls.push({ sql, params });
			return { affectedRows: 1 };
		},
		getBriefingVersionFn: async () => ({
			id: 1,
			jobId: 'job-1',
			versionNumber: 2,
			artifactSchemaVersion: 'briefing-document/v1',
			artifact: {
				schemaVersion: 'briefing-document/v1',
				jobId: 'job-1',
				briefingId: 'briefing-1',
				title: 'Title',
				topic: 'Topic',
				summary: 'Summary',
				generatedAt: '2026-05-22T00:00:00Z',
				locale: 'en-US',
				generatedBy: 'hermes',
				validation: { valid: true, warnings: [], errors: [] },
				assets: [],
				audioAsset: null,
				sections: [],
				sources: [],
				timelineCues: []
			},
			provenance: { schemaVersion: 'briefing-provenance/v1', originalPrompt: 'prompt', systemPrompt: null, requestedChanges: [], sourceSummary: null, sourceUrls: [], provider: null, model: null, conversationId: null, sourceMessageId: null, toolName: null, metadata: {} },
			creationReason: 'initial_generation',
			createdByProvider: null,
			createdByModel: null,
			createdAt: '2026-05-22T00:00:00Z'
		})
	});

	assert.equal(claimed?.renderJobId, 'render-job-1');
	assert.equal(claimed?.audioStorageKey, 'webui/briefings/job-1/audio.mp3');
	assert.equal(executeCalls.length, 2);
	assert.equal(executeCalls[0].params.id, 'render-job-1');
	assert.equal(executeCalls[1].params.job_id, 'job-1');
});

test('markBriefingRenderJobProgress updates the briefing stage and progress metadata', async () => {
	const executeCalls = [];
	const progress = await markBriefingRenderJobProgress('render-job-1', 'encoding_audio', {
		percent: 58,
		detail: 'Encoding the refreshed audio track.',
		sentenceTotal: 59,
		sentenceCompleted: 12
	}, {
		queryFn: async () => [
			{
				id: 'render-job-1',
				job_id: 'job-1',
				briefing_version_number: 2,
				requested_by_user_id: 'user-1',
				status: 'processing',
				error_message: null,
				created_at: '2026-05-22T00:00:00Z',
				claimed_at: '2026-05-22T00:00:05Z',
				completed_at: null
			}
		],
		executeFn: async (sql, params) => {
			executeCalls.push({ sql, params });
			return { affectedRows: 1 };
		}
	});

	assert.deepEqual(progress, { renderJobId: 'render-job-1', jobId: 'job-1', stage: 'encoding_audio' });
	assert.equal(executeCalls[1].params.stage, 'encoding_audio');
	assert.equal(executeCalls[1].params.progress_percent, 58);
	assert.equal(executeCalls[1].params.sentence_total, 59);
	assert.equal(executeCalls[1].params.sentence_completed, 12);
});

test('completeBriefingRenderJob updates the canonical artifact and briefing state', async () => {
	const executeCalls = [];
	const updatedArtifacts = [];
	const completed = await completeBriefingRenderJob('render-job-1', {
		audioAsset: {
			path: 'audio-rerendered.mp3',
			contentType: 'audio/mpeg',
			sizeBytes: 42,
			sha256: 'abc123'
		},
		validation: { valid: true, warnings: [], errors: [] },
		completedAt: '2026-05-22T00:03:00Z'
	}, {
		queryFn: async () => [
			{
				id: 'render-job-1',
				job_id: 'job-1',
				briefing_version_number: 2,
				requested_by_user_id: 'user-1',
				status: 'processing',
				error_message: null,
				created_at: '2026-05-22T00:00:00Z',
				claimed_at: '2026-05-22T00:00:05Z',
				completed_at: null
			}
		],
		getBriefingVersionFn: async () => ({
			id: 1,
			jobId: 'job-1',
			versionNumber: 2,
			artifactSchemaVersion: 'briefing-document/v1',
			artifact: {
				schemaVersion: 'briefing-document/v1',
				jobId: 'job-1',
				briefingId: 'briefing-1',
				title: 'Title',
				topic: 'Topic',
				summary: 'Summary',
				generatedAt: '2026-05-22T00:00:00Z',
				locale: 'en-US',
				generatedBy: 'hermes',
				validation: { valid: true, warnings: [], errors: [] },
				assets: [],
				audioAsset: null,
				sections: [],
				sources: [],
				timelineCues: []
			},
			provenance: null,
			creationReason: 'initial_generation',
			createdByProvider: null,
			createdByModel: null,
			createdAt: '2026-05-22T00:00:00Z'
		}),
		updateBriefingVersionArtifactFn: async (_jobId, _versionNumber, artifact) => {
			updatedArtifacts.push(artifact);
			return { jobId: 'job-1', versionNumber: 2 };
		},
		executeFn: async (sql, params) => {
			executeCalls.push({ sql, params });
			return { affectedRows: 1 };
		}
	});

	assert.equal(completed?.audioStorageKey, 'webui/briefings/job-1/audio-rerendered.mp3');
	assert.equal(updatedArtifacts[0].audioAsset?.path, 'audio-rerendered.mp3');
	assert.equal(updatedArtifacts[0].assets[0].path, 'audio-rerendered.mp3');
	assert.equal(executeCalls.length, 3);
	assert.match(executeCalls[2].sql, /progress_percent = 100/);
	assert.equal(executeCalls[2].params.validation_valid, 1);
});

test('failBriefingRenderJob marks the render and briefing as failed', async () => {
	const executeCalls = [];
	const failed = await failBriefingRenderJob('render-job-1', 'Renderer crashed', {
		queryFn: async () => [
			{
				id: 'render-job-1',
				job_id: 'job-1',
				briefing_version_number: 2,
				requested_by_user_id: 'user-1',
				status: 'processing',
				error_message: null,
				created_at: '2026-05-22T00:00:00Z',
				claimed_at: '2026-05-22T00:00:05Z',
				completed_at: null
			}
		],
		executeFn: async (sql, params) => {
			executeCalls.push({ sql, params });
			return { affectedRows: 1 };
		}
	});

	assert.equal(failed?.errorMessage, 'Renderer crashed');
	assert.equal(executeCalls.length, 2);
	assert.match(executeCalls[1].sql, /progress_percent = 100/);
	assert.equal(executeCalls[1].params.error_message, 'Renderer crashed');
});