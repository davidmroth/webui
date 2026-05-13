import test from 'node:test';
import assert from 'node:assert/strict';

import { loadBriefingPreview } from './briefings.ts';

test('loadBriefingPreview reads a published briefing manifest from storage without calling the renderer', async () => {
	const manifest = {
		schema_version: 'briefing-renderer/v1',
		render_mode: 'synthetic-v1',
		job_id: 'job-storage-123',
		briefing_id: 'briefing-storage-123',
		title: 'Stored Briefing',
		topic: 'Storage-backed preview',
		summary: 'Loaded from object storage.',
		generated_at: '2026-05-13T10:00:00+00:00',
		locale: 'en-US',
		generated_by: 'hermes',
		standalone_html_path: 'standalone.html',
		audio_path: 'audio.mp3',
		sections: [],
		sources: [],
		timeline_cues: [],
		assets: [
			{ role: 'audio', path: 'audio.mp3', content_type: 'audio/mpeg', size_bytes: 12, sha256: 'a', cache_control: 'private, max-age=300' },
			{ role: 'standalone_html', path: 'standalone.html', content_type: 'text/html; charset=utf-8', size_bytes: 12, sha256: 'b', cache_control: 'private, max-age=0, must-revalidate' }
		],
		validation: { valid: true, warnings: [], errors: [] }
	};

	const preview = await loadBriefingPreview('job-storage-123', {
		fetchImpl: async () => {
			throw new Error('renderer should not be called');
		},
		readObjectBuffer: async (storageKey) => {
			assert.equal(storageKey, 'webui/briefings/job-storage-123/briefing.json');
			return Buffer.from(JSON.stringify(manifest), 'utf-8');
		}
	});

	assert.equal(preview.state, 'ready');
	assert.equal(preview.jobId, 'job-storage-123');
	assert.equal(preview.exportHtmlAsset?.url, '/briefings/job-storage-123');
	assert.equal(preview.audioAsset?.url, '/api/briefings/job-storage-123/assets/audio.mp3');
});

test('loadBriefingPreview explains production misconfiguration when renderer uses local fallback url', async () => {
	const preview = await loadBriefingPreview('job-prod-fail', {
		baseUrl: 'http://host.docker.internal:9910',
		fetchImpl: async () => {
			throw new TypeError('fetch failed');
		}
	});

	assert.equal(preview.state, 'error');
	assert.equal(preview.message, 'Briefing preview is temporarily unavailable.');
	assert.match(preview.detail ?? '', /BRIEFING_RENDERER_BASE_URL/);
	assert.equal(preview.canRetry, false);
});

test('loadBriefingPreview does not expose storage paths when object storage reads fail', async () => {
	const preview = await loadBriefingPreview('job-storage-error', {
		baseUrl: '',
		readObjectBuffer: async () => {
			throw new Error('S3 getObject failed for s3://secret-bucket/webui/briefings/job-storage-error/briefing.json');
		}
	});

	assert.equal(preview.state, 'error');
	assert.equal(preview.message, 'Briefing preview is temporarily unavailable.');
	assert.equal(preview.canRetry, true);
	assert.doesNotMatch(preview.detail ?? '', /s3:\/\//i);
	assert.doesNotMatch(preview.detail ?? '', /secret-bucket/i);
	assert.match(preview.detail ?? '', /object storage/i);
});

test('loadBriefingPreview marks reachable renderer network failures as retryable', async () => {
	const preview = await loadBriefingPreview('job-network-fail', {
		baseUrl: 'https://briefing.example.internal',
		fetchImpl: async () => {
			throw new TypeError('fetch failed');
		}
	});

	assert.equal(preview.state, 'error');
	assert.equal(preview.message, 'Briefing preview is temporarily unavailable.');
	assert.match(preview.detail ?? '', /could not reach the briefing renderer/i);
	assert.equal(preview.canRetry, true);
});