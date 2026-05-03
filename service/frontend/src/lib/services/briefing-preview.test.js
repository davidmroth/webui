import test from 'node:test';
import assert from 'node:assert/strict';

import {
	buildBriefingPreviewApiPath,
	estimateBriefingRenderProgress,
	fetchBriefingPreview
} from './briefing-preview.ts';

test('buildBriefingPreviewApiPath normalizes the base path', () => {
	assert.equal(buildBriefingPreviewApiPath('job-42', '/console/'), '/console/api/briefings/job-42');
});

test('estimateBriefingRenderProgress returns an estimated percentage and eta for active jobs', () => {
	const createdAt = '2026-05-03T15:00:00.000Z';
	const estimate = estimateBriefingRenderProgress(
		{ createdAt, renderProgress: null },
		Date.parse('2026-05-03T15:00:42.000Z')
	);

	assert.equal(estimate.source, 'estimated');
	assert.equal(estimate.summary, 'Research has been completed, and the briefing is being generated.');
	assert.equal(estimate.stageLabel, 'Syncing narration, cue timing, and HTML');
	assert.equal(estimate.percent, 64);
	assert.equal(estimate.elapsedMs, 42_000);
	assert.equal(estimate.etaMs, 33_000);
});

test('estimateBriefingRenderProgress caps long-running jobs below completion until the renderer finishes', () => {
	const estimate = estimateBriefingRenderProgress(
		{ createdAt: '2026-05-03T15:00:00.000Z', renderProgress: null },
		Date.parse('2026-05-03T15:03:00.000Z')
	);

	assert.equal(estimate.percent, 94);
	assert.equal(estimate.etaMs, null);
	assert.equal(estimate.stageLabel, 'Running final validation and packaging');
});

test('estimateBriefingRenderProgress prefers renderer-backed stage data when available', () => {
	const estimate = estimateBriefingRenderProgress(
		{
			createdAt: '2026-05-03T15:00:00.000Z',
			renderProgress: {
				stage: 'rendering_narration',
				percent: 58,
				detail: 'Rendered narration sentence 26 of 45.',
				sentenceTotal: 45,
				sentenceCompleted: 26
			}
		},
		Date.parse('2026-05-03T15:01:00.000Z')
	);

	assert.equal(estimate.source, 'renderer');
	assert.equal(estimate.percent, 58);
	assert.equal(estimate.etaMs, null);
	assert.equal(estimate.stageLabel, 'Rendering narration and timing cues');
	assert.equal(estimate.summary, 'The renderer is actively generating spoken narration for this briefing.');
	assert.equal(estimate.detail, 'Rendered narration sentence 26 of 45.');
	assert.equal(estimate.trailingLabel, '26 of 45 narration segments completed');
});

test('fetchBriefingPreview accepts non-200 preview states from the WebUI route', async () => {
	const processingPreview = {
		state: 'processing',
		status: 'processing',
		jobId: 'job-202',
		briefingId: null,
		createdAt: '2026-05-03T15:00:00.000Z',
		completedAt: null,
		error: null,
		validation: null,
		assetCount: 0,
		renderProgress: null
	};

	const result = await fetchBriefingPreview('job-202', {
		basePath: '/app',
		fetchImpl: async (url, init) => {
			assert.equal(url, '/app/api/briefings/job-202');
			assert.equal(init?.method, 'GET');
			return new Response(JSON.stringify(processingPreview), {
				status: 202,
				headers: { 'Content-Type': 'application/json' }
			});
		}
	});

	assert.deepEqual(result, processingPreview);
});