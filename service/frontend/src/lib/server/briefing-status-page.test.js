import test from 'node:test';
import assert from 'node:assert/strict';

import {
	renderBriefingStatusPage,
	statusCodeForBriefingPreviewState
} from './briefing-status-page.ts';

test('statusCodeForBriefingPreviewState maps preview states to HTTP status codes', () => {
	assert.equal(statusCodeForBriefingPreviewState('processing'), 202);
	assert.equal(statusCodeForBriefingPreviewState('failed'), 409);
	assert.equal(statusCodeForBriefingPreviewState('missing'), 404);
	assert.equal(statusCodeForBriefingPreviewState('error'), 502);
});

test('renderBriefingStatusPage builds an auto-refreshing processing page', () => {
	const html = renderBriefingStatusPage({
		state: 'processing',
		status: 'processing',
		jobId: 'job-202',
		briefingId: 'briefing-202',
		createdAt: '2026-05-07T07:00:00.000Z',
		completedAt: null,
		error: null,
		validation: null,
		assetCount: 0,
		renderProgress: {
			stage: 'rendering_narration',
			percent: 58,
			detail: 'Rendered narration chunk 3 of 19.',
			sentenceTotal: 54,
			sentenceCompleted: 10
		}
	});

	assert.match(html, /<meta http-equiv="refresh" content="3"/);
	assert.match(html, /briefing-202/);
	assert.match(html, /Rendered narration chunk 3 of 19\./);
	assert.match(html, /58%/);
	assert.match(html, /Return to chat/);
	assert.doesNotMatch(html, /Open raw status JSON/);
});

test('renderBriefingStatusPage surfaces failure details without auto-refresh', () => {
	const html = renderBriefingStatusPage({
		state: 'failed',
		status: 'failed',
		jobId: 'job-fail',
		briefingId: 'briefing-fail',
		createdAt: '2026-05-07T07:00:00.000Z',
		completedAt: '2026-05-07T07:02:00.000Z',
		error: 'ffmpeg MP3 encoding failed',
		validation: null,
		assetCount: 0,
		renderProgress: null
	});

	assert.doesNotMatch(html, /http-equiv="refresh"/);
	assert.match(html, /Briefing render failed/);
	assert.match(html, /ffmpeg MP3 encoding failed/);
	assert.match(html, /Return to chat/);
});