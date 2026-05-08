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