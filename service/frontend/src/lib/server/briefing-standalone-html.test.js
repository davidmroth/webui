import test from 'node:test';
import assert from 'node:assert/strict';

import { buildBriefingPageHtml, rewriteStandaloneAssetUrls } from './briefing-standalone-html.ts';

test('buildBriefingPageHtml falls back to narration text when section body is empty', () => {
	const html = buildBriefingPageHtml(
		{
			title: 'Fallback briefing',
			topic: 'Standalone text fallback',
			generatedAt: '2026-05-19T00:00:00Z',
			locale: 'en-US',
			audioUrl: '/audio.mp3',
			sections: [
				{
					id: 'section-1',
					title: 'Executive Summary',
					body: [],
					narration: 'The missing paragraph should still render even when body is empty.',
					metrics: [],
					start: 0,
					end: 30,
					cue: null
				}
			],
			sources: []
		},
		'job-42'
	);

	assert.match(html, /<p>The missing paragraph should still render even when body is empty\.<\/p>/);
});

test('buildBriefingPageHtml renders sentence-level cue targets for clickable article text', () => {
	const html = buildBriefingPageHtml(
		{
			title: 'Cue-linked briefing',
			topic: 'Sentence cue targets',
			generatedAt: '2026-05-19T00:00:00Z',
			locale: 'en-US',
			audioUrl: '/audio.mp3',
			sections: [
				{
					id: 'section-1',
					title: 'Executive Summary',
					body: ['This paragraph should defer to sentence cue markup.'],
					narration: 'This paragraph should defer to sentence cue markup.',
					sentences: [
						{
							text: 'First sentence.',
							start: 12.5,
							end: 15.1,
							cue: null
						},
						{
							text: 'Second sentence.',
							start: 15.1,
							end: 18.2,
							cue: { start: 15.25, end: 18.25 }
						}
					],
					metrics: [],
					start: 0,
					end: 30,
					cue: null
				}
			],
			sources: []
		},
		'job-42'
	);

	assert.match(html, /class="section-sentence" data-start="12\.5" data-end="15\.1"/);
	assert.match(html, /class="section-sentence" data-start="15\.25" data-end="18\.25"/);
	assert.doesNotMatch(html, /<p>This paragraph should defer to sentence cue markup\.<\/p>/);
});

test('buildBriefingPageHtml emits the article rail wrapper expected by the standalone dock', () => {
	const html = buildBriefingPageHtml(
		{
			title: 'Rail briefing',
			topic: 'Dock layout',
			generatedAt: '2026-05-19T00:00:00Z',
			locale: 'en-US',
			audioUrl: '/audio.mp3',
			sections: [
				{
					id: 'section-1',
					title: 'Executive Summary',
					body: ['Rail content.'],
					metrics: [],
					start: 0,
					end: 30,
					cue: null
				}
			],
			sources: []
		},
		'job-42'
	);

	assert.match(html, /<aside class="article-rail"><nav class="article-nav">/);
	assert.match(html, /href="\/briefing-standalone-page\.css"/);
	assert.match(html, /id="webui-standalone-player-dock"/);
	assert.match(html, /src="\/briefing-standalone-player-dock\.js"/);
	assert.match(html, /class="briefing-back-link" href="\/briefings"/);
	assert.match(html, /aria-label="Back to briefings"/);
	assert.match(html, /id="webui-briefing-back-nav"/);
});

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

test('rewriteStandaloneAssetUrls injects the standalone narration dock override', () => {
	const html = rewriteStandaloneAssetUrls(
		'<html><head><link rel="stylesheet" href="./player.css" /></head><body><main class="page-shell"><section class="hero"><div class="hero-audio" data-sticky-player><div class="hero-audio-player"><div class="hero-audio-label">Narration</div><audio controls preload="metadata" data-briefing-audio><source src="./audio.mp3" type="audio/mpeg" /></audio></div></div></section><div class="content-shell"><aside class="article-rail"><section class="rail-card">Rail</section></aside><div class="article-body">Body</div></div></main><script src="./player.js"></script></body></html>',
		'job-42'
	);

	assert.match(html, /webui-standalone-player-dock/);
	assert.match(html, /href="\/briefing-standalone-player-dock\.css"/);
	assert.match(html, /src="\/briefing-standalone-player-dock\.js"/);
	assert.match(html, /class="briefing-back-link" href="\/briefings"/);
	assert.match(html, /aria-label="Back to briefings"/);
});

test('rewriteStandaloneAssetUrls does not duplicate the back nav when already present', () => {
	const html = rewriteStandaloneAssetUrls(
		'<html><body><main class="page-shell"><a class="briefing-back-link" href="/briefings">Back</a><h1>Briefing</h1></main></body></html>',
		'job-42'
	);

	assert.equal(html.match(/class="briefing-back-link"/g)?.length, 1);
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
	assert.match(html, /id="briefing-share-launcher"/);
	assert.match(html, /href="\/briefing-standalone-management\.css"/);
	assert.match(html, /src="\/briefing-standalone-management\.js"/);
	assert.match(html, /role="dialog"/);
	assert.match(html, /data-standalone-path="\/briefings\/job-42"/);
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