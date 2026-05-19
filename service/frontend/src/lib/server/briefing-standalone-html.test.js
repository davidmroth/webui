import test from 'node:test';
import assert from 'node:assert/strict';

import { rewriteStandaloneAssetUrls } from './briefing-standalone-html.ts';

test('rewriteStandaloneAssetUrls leaves fragment links anchored to the current page', () => {
	const html = rewriteStandaloneAssetUrls(
		'<html><head><link rel="stylesheet" href="./player.css" /></head><body><a href="#intro">Intro</a><audio><source src="./audio.mp3" /></audio><script src="./player.js"></script></body></html>',
		'job 42'
	);

	assert.doesNotMatch(html, /<base /);
	assert.match(html, /href="\/api\/briefings\/job%2042\/assets\/player\.css"/);
	assert.match(html, /src="\/api\/briefings\/job%2042\/assets\/audio\.mp3"/);
	assert.match(html, /src="\/api\/briefings\/job%2042\/assets\/player\.js"/);
	assert.match(html, /href="#intro"/);
});

test('rewriteStandaloneAssetUrls rewrites illustration assets', () => {
	const html = rewriteStandaloneAssetUrls(
		'<img src="./illustrations/chart 1.svg" alt="Chart" />',
		'job-42'
	);

	assert.match(
		html,
		/src="\/api\/briefings\/job-42\/assets\/illustrations\/chart%201\.svg"/
	);
});

test('rewriteStandaloneAssetUrls injects standalone sharing controls for managers', () => {
	const html = rewriteStandaloneAssetUrls('<html><body><h1>Briefing</h1></body></html>', 'job-42', {
		canManage: true,
		isPublic: false,
		standalonePath: '/briefings/job-42'
	});

	assert.match(html, /HTML export is private/);
	assert.match(html, /Manage access/);
	assert.match(html, /Make public/);
	assert.match(html, /Copy link/);
	assert.match(html, /role="dialog"/);
	assert.match(html, /data-standalone-path="\/briefings\/job-42"/);
	assert.match(html, /dialog\.dataset\.open = open \? 'true' : 'false'/);
	assert.match(html, /fetch\('\/api\/briefings\/' \+ encodeURIComponent\(jobId\) \+ '\/sharing'/);
});

test('rewriteStandaloneAssetUrls does not inject standalone sharing controls for viewers', () => {
	const html = rewriteStandaloneAssetUrls('<html><body><h1>Briefing</h1></body></html>', 'job-42', {
		canManage: false,
		isPublic: true,
		standalonePath: '/briefings/job-42'
	});

	assert.doesNotMatch(html, /briefing-share-manager/);
	assert.doesNotMatch(html, /Make private/);
});