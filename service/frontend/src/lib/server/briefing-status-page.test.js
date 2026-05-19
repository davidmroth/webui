import test from 'node:test';
import assert from 'node:assert/strict';

import {
	renderBriefingUnauthorizedPage,
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
		error: 'The renderer timed out while verifying the briefing assets.',
		detail: 'Retry loading the briefing. The export may already be available.',
		validation: null,
		assetCount: 0,
		renderProgress: null,
		canRetry: true
	}, {
		retryBriefingAction: '/briefings/briefing-fail',
		retryHref: '/briefings/briefing-fail?retry=1'
	});

	assert.doesNotMatch(html, /http-equiv="refresh"/);
	assert.match(html, /Briefing render failed/);
	assert.match(html, /The renderer timed out while verifying the briefing assets\./);
	assert.match(html, /Retry loading the briefing\. The export may already be available\./);
	assert.match(html, /<form method="POST" action="\/briefings\/briefing-fail">/);
	assert.match(html, /Rebuild briefing/);
	assert.doesNotMatch(html, /Retry loading briefing/);
	assert.match(html, /Return to chat/);
});

test('renderBriefingStatusPage labels publish-pending previews as publishing instead of unavailable', () => {
	const html = renderBriefingStatusPage({
		state: 'processing',
		status: 'processing',
		jobId: 'job-publish',
		briefingId: 'briefing-publish',
		createdAt: '2026-05-07T07:00:00.000Z',
		completedAt: '2026-05-07T07:02:00.000Z',
		error: null,
		validation: null,
		assetCount: 0,
		renderProgress: {
			stage: 'publishing_bundle',
			percent: 100,
			detail: 'Rendering finished, and the WebUI is waiting for the published bundle to arrive in object storage.',
			sentenceTotal: null,
			sentenceCompleted: null
		}
	});

	assert.match(html, /Publishing briefing/);
	assert.match(html, /published briefing bundle becomes available/i);
	assert.match(html, /Checking for the published bundle/);
	assert.match(html, /Reached 100% at May 7, 2026, 7:02:00 AM/);
	assert.doesNotMatch(html, /Briefing status unavailable/);
});

test('renderBriefingStatusPage omits retry-loading links from the status page actions', () => {
	const html = renderBriefingStatusPage({
		state: 'failed',
		status: 'failed',
		jobId: 'job-timeout',
		briefingId: 'briefing-timeout',
		createdAt: '2026-05-07T07:00:00.000Z',
		completedAt: '2026-05-07T07:02:00.000Z',
		error: 'The renderer timed out while verifying the briefing assets.',
		detail: 'Retry loading the briefing. The export may already be available.',
		validation: null,
		assetCount: 1,
		renderProgress: null,
		canRetry: true
	}, {
		retryHref: '/briefings/briefing-timeout?retry=1&from=status'
	});

	assert.doesNotMatch(html, /Retry loading briefing/);
	assert.doesNotMatch(html, /retry=1&amp;from=status/);
	assert.doesNotMatch(html, /https:\/\//);
	assert.match(html, /Return to chat/);
});

test('renderBriefingUnauthorizedPage shows a private standalone message without login prompts', () => {
	const html = renderBriefingUnauthorizedPage('job-private');

	assert.match(html, /This standalone briefing is private\./);
	assert.match(html, /The owner has not enabled public access for this standalone export\./);
	assert.doesNotMatch(html, /\/login/);
	assert.doesNotMatch(html, /Sign in/i);
});