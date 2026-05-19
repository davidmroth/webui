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
	assert.match(html, /const rail = document\.querySelector\('\.article-rail'\);/);
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
	assert.match(html, /webui-docked-player/);
	assert.match(html, /webui-narration-toolbar/);
	assert.match(html, /matchMedia\('\(max-width: 960px\)'\)/);
	assert.match(html, /data-webui-placement/);
	assert.match(html, /function setPlacement\(nextPlacement\)/);
	assert.match(html, /setExpanded\(true\)/);
	assert.match(html, /function handleDelegatedCueSeek\(event\)/);
	assert.match(html, /document\.addEventListener\('click', handleDelegatedCueSeek, true\)/);
	assert.match(html, /startNode instanceof Node\s*\?\s*startNode\.parentElement/);
	assert.match(html, /const isBodyTextClick =/);
	assert.match(html, /const directTarget = baseElement\.closest\('\[data-start\]\[data-end\]'\);/);
	assert.match(html, /if \(directTarget instanceof HTMLElement\) \{/);
	assert.match(html, /if \(isBodyTextClick && sectionCard instanceof HTMLElement\) \{/);
	assert.match(html, /function syncActiveCueState\(\)/);
	assert.match(html, /target\.dataset\.webuiActive = isActive \? 'true' : 'false'/);
	assert.match(html, /function seekAndPlay\(cueStart\)/);
	assert.match(html, /const canSeekNow = \(\) => \{/);
	assert.match(html, /if \(canSeekNow\(\)\) \{/);
	assert.match(html, /audio\.addEventListener\('loadedmetadata', replaySeek, \{ once: true \}\);/);
	assert.match(html, /audio\.addEventListener\('canplay', replaySeek, \{ once: true \}\);/);
	assert.match(html, /seekAndPlay\(cueStart\);/);
	assert.match(html, /function bindDirectCueSeek\(\)/);
	assert.match(html, /document\.querySelectorAll\('\.section-sentence, \.section-body p'\)/);
	assert.match(html, /const cueSource =/);
	assert.match(html, /bindDirectCueSeek\(\);/);
	assert.match(html, /article-rail/);
	assert.match(html, /Current cue/);
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
	assert.match(html, /#briefing-share-launcher/);
	assert.match(html, /background: rgba\(17, 24, 39, 0\.94\)/);
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