import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchBriefingAsset, loadBriefingPreview } from './briefings.ts';

function storageJson(payload) {
	return Buffer.from(JSON.stringify(payload), 'utf-8');
}

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

test('loadBriefingPreview returns published processing status when the bundle is missing', async () => {
	const preview = await loadBriefingPreview('job-processing-123', {
		readObjectBuffer: async (storageKey) => {
			if (storageKey === 'webui/briefings/job-processing-123/briefing.json') {
				throw Object.assign(new Error('NoSuchKey'), { code: 'NoSuchKey' });
			}
			assert.equal(storageKey, 'webui/briefings/job-processing-123/status.json');
			return storageJson({
				job_id: 'job-processing-123',
				briefing_id: 'briefing-processing-123',
				status: 'processing',
				stage: 'packaging_assets',
				progress_percent: 97,
				progress_detail: 'Writing packaged briefing assets.',
				sentence_total: 59,
				sentence_completed: 59,
				created_at: '2026-05-13T17:03:53.185024+00:00',
				completed_at: null,
				error: null,
				validation: null,
				asset_count: 0
			});
		}
	});

	assert.equal(preview.state, 'processing');
	assert.equal(preview.status, 'processing');
	assert.equal(preview.jobId, 'job-processing-123');
	assert.equal(preview.briefingId, 'briefing-processing-123');
	assert.equal(preview.renderProgress?.stage, 'packaging_assets');
	assert.equal(preview.renderProgress?.percent, 97);
	assert.equal(preview.renderProgress?.detail, 'Writing packaged briefing assets.');
	assert.equal(preview.renderProgress?.sentenceTotal, 59);
	assert.equal(preview.renderProgress?.sentenceCompleted, 59);
});

test('loadBriefingPreview reports publish-pending progress when status is completed but the manifest is still missing', async () => {
	const preview = await loadBriefingPreview('job-prod-fail', {
		readObjectBuffer: async (storageKey) => {
			if (storageKey === 'webui/briefings/job-prod-fail/briefing.json') {
				throw Object.assign(new Error('NoSuchKey'), { code: 'NoSuchKey' });
			}
			assert.equal(storageKey, 'webui/briefings/job-prod-fail/status.json');
			return storageJson({
				job_id: 'job-prod-fail',
				briefing_id: 'briefing-prod-fail',
				status: 'completed',
				stage: 'completed',
				progress_percent: 100,
				progress_detail: 'Briefing ready.',
				created_at: '2026-05-13T17:03:53.185024+00:00',
				completed_at: '2026-05-13T17:05:53.185024+00:00',
				validation: null,
				asset_count: 0
			});
		}
	});

	assert.equal(preview.state, 'processing');
	assert.equal(preview.status, 'processing');
	assert.equal(preview.renderProgress?.stage, 'publishing_bundle');
	assert.equal(preview.renderProgress?.percent, 100);
	assert.match(preview.renderProgress?.detail ?? '', /briefing ready|published bundle|object storage/i);
	assert.doesNotMatch(preview.renderProgress?.detail ?? '', /BRIEFING_RENDERER_/);
});

test('loadBriefingPreview fails closed when publishing stays incomplete after the timeout window', async () => {
	const preview = await loadBriefingPreview('job-publish-timeout', {
		readObjectBuffer: async (storageKey) => {
			if (storageKey === 'webui/briefings/job-publish-timeout/briefing.json') {
				throw Object.assign(new Error('NoSuchKey'), { code: 'NoSuchKey' });
			}
			assert.equal(storageKey, 'webui/briefings/job-publish-timeout/status.json');
			return storageJson({
				job_id: 'job-publish-timeout',
				briefing_id: 'briefing-publish-timeout',
				status: 'completed',
				stage: 'completed',
				progress_percent: 100,
				progress_detail: 'Briefing ready.',
				created_at: '2026-05-13T17:03:53.185024+00:00',
				completed_at: '2026-05-13T17:05:53.185024+00:00',
				validation: null,
				asset_count: 0
			});
		},
		now: Date.parse('2026-05-13T17:12:00.000Z')
	});

	assert.equal(preview.state, 'failed');
	assert.equal(preview.error, 'Publishing the briefing bundle timed out.');
	assert.match(preview.detail ?? '', /same bucket and prefix/i);
	assert.equal(preview.renderProgress?.stage, 'publishing_bundle');
	assert.equal(preview.renderProgress?.percent, 100);
	assert.equal(preview.canRetry, true);
});

test('loadBriefingPreview fails closed immediately when the published status reports object-storage publishing timed out', async () => {
	const preview = await loadBriefingPreview('job-publish-warning', {
		readObjectBuffer: async (storageKey) => {
			if (storageKey === 'webui/briefings/job-publish-warning/briefing.json') {
				throw Object.assign(new Error('NoSuchKey'), { code: 'NoSuchKey' });
			}
			assert.equal(storageKey, 'webui/briefings/job-publish-warning/status.json');
			return storageJson({
				job_id: 'job-publish-warning',
				briefing_id: 'briefing-publish-warning',
				status: 'completed',
				stage: 'completed',
				progress_percent: 100,
				progress_detail: 'Briefing ready.',
				created_at: '2026-05-13T17:03:53.185024+00:00',
				completed_at: '2026-05-13T17:05:53.185024+00:00',
				validation: {
					valid: true,
					warnings: ['External object-storage publishing timed out. Renderer-hosted briefing assets remain available.'],
					errors: []
				},
				asset_count: 0
			});
		}
	});

	assert.equal(preview.state, 'failed');
	assert.equal(preview.error, 'Publishing the briefing bundle timed out.');
	assert.match(preview.detail ?? '', /renderer-hosted briefing assets remain available/i);
	assert.equal(preview.canRetry, true);
});

test('loadBriefingPreview reports export unavailable when neither the manifest nor status snapshot exists', async () => {
	const preview = await loadBriefingPreview('job-missing-123', {
		readObjectBuffer: async () => {
			throw Object.assign(new Error('NoSuchKey'), { code: 'NoSuchKey' });
		}
	});

	assert.equal(preview.state, 'error');
	assert.equal(preview.message, 'Briefing export is not available yet.');
	assert.match(preview.detail ?? '', /published briefing bundle/i);
	assert.equal(preview.canRetry, true);
});

test('loadBriefingPreview does not expose storage paths when object storage reads fail', async () => {
	const preview = await loadBriefingPreview('job-storage-error', {
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

test('fetchBriefingAsset returns 404 instead of calling the renderer when a published asset is missing', async () => {
	const response = await fetchBriefingAsset('job-network-fail', 'audio.mp3', {
		readObjectBuffer: async () => {
			throw Object.assign(new Error('NoSuchKey'), { code: 'NoSuchKey' });
		}
	});

	assert.equal(response.status, 404);
	assert.match(await response.text(), /published briefing asset not found/i);
});

test('fetchBriefingAsset supports byte-range requests for audio assets', async () => {
	const manifest = {
		schema_version: 'briefing-renderer/v1',
		render_mode: 'synthetic-v1',
		job_id: 'job-range-123',
		briefing_id: 'briefing-range-123',
		title: 'Range Briefing',
		topic: 'Range support',
		summary: null,
		generated_at: '2026-05-13T10:00:00+00:00',
		locale: 'en-US',
		generated_by: 'hermes',
		standalone_html_path: 'standalone.html',
		audio_path: 'audio.mp3',
		sections: [],
		sources: [],
		timeline_cues: [],
		assets: [
			{ role: 'audio', path: 'audio.mp3', content_type: 'audio/mpeg', size_bytes: 12, sha256: 'a', cache_control: 'private, max-age=300' }
		],
		validation: { valid: true, warnings: [], errors: [] }
	};

	const response = await fetchBriefingAsset('job-range-123', 'audio.mp3', {
		readObjectBuffer: async (storageKey) => {
			if (storageKey.endsWith('/briefing.json')) {
				return Buffer.from(JSON.stringify(manifest), 'utf-8');
			}

			assert.equal(storageKey, 'webui/briefings/job-range-123/audio.mp3');
			return Buffer.from('ABCDEFGHIJ', 'utf-8');
		},
		requestHeaders: new Headers({ range: 'bytes=2-5' })
	});

	assert.equal(response.status, 206);
	assert.equal(response.headers.get('accept-ranges'), 'bytes');
	assert.equal(response.headers.get('content-range'), 'bytes 2-5/10');
	assert.equal(response.headers.get('content-length'), '4');
	assert.equal(await response.text(), 'CDEF');
	assert.equal(response.headers.get('etag'), '"a"');
});

test('fetchBriefingAsset returns 416 for invalid byte-range requests', async () => {
	const manifest = {
		schema_version: 'briefing-renderer/v1',
		render_mode: 'synthetic-v1',
		job_id: 'job-range-416',
		briefing_id: 'briefing-range-416',
		title: 'Range Briefing',
		topic: 'Range support',
		summary: null,
		generated_at: '2026-05-13T10:00:00+00:00',
		locale: 'en-US',
		generated_by: 'hermes',
		standalone_html_path: 'standalone.html',
		audio_path: 'audio.mp3',
		sections: [],
		sources: [],
		timeline_cues: [],
		assets: [
			{ role: 'audio', path: 'audio.mp3', content_type: 'audio/mpeg', size_bytes: 12, sha256: 'a', cache_control: 'private, max-age=300' }
		],
		validation: { valid: true, warnings: [], errors: [] }
	};

	const response = await fetchBriefingAsset('job-range-416', 'audio.mp3', {
		readObjectBuffer: async (storageKey) => {
			if (storageKey.endsWith('/briefing.json')) {
				return Buffer.from(JSON.stringify(manifest), 'utf-8');
			}

			assert.equal(storageKey, 'webui/briefings/job-range-416/audio.mp3');
			return Buffer.from('ABCDEFGHIJ', 'utf-8');
		},
		requestHeaders: new Headers({ range: 'bytes=999-1000' })
	});

	assert.equal(response.status, 416);
	assert.equal(response.headers.get('accept-ranges'), 'bytes');
	assert.equal(response.headers.get('content-range'), 'bytes */10');
});

test('fetchBriefingAsset returns 304 when ETag matches without range', async () => {
	const manifest = {
		schema_version: 'briefing-renderer/v1',
		render_mode: 'synthetic-v1',
		job_id: 'job-etag-304',
		briefing_id: 'briefing-etag-304',
		title: 'Range Briefing',
		topic: 'Range support',
		summary: null,
		generated_at: '2026-05-13T10:00:00+00:00',
		locale: 'en-US',
		generated_by: 'hermes',
		standalone_html_path: 'standalone.html',
		audio_path: 'audio.mp3',
		sections: [],
		sources: [],
		timeline_cues: [],
		assets: [
			{ role: 'audio', path: 'audio.mp3', content_type: 'audio/mpeg', size_bytes: 12, sha256: 'etag-audio', cache_control: 'private, max-age=300' }
		],
		validation: { valid: true, warnings: [], errors: [] }
	};

	const response = await fetchBriefingAsset('job-etag-304', 'audio.mp3', {
		readObjectBuffer: async (storageKey) => {
			if (storageKey.endsWith('/briefing.json')) {
				return Buffer.from(JSON.stringify(manifest), 'utf-8');
			}

			assert.equal(storageKey, 'webui/briefings/job-etag-304/audio.mp3');
			return Buffer.from('ABCDEFGHIJ', 'utf-8');
		},
		requestHeaders: new Headers({ 'if-none-match': '"etag-audio"' })
	});

	assert.equal(response.status, 304);
	assert.equal(response.headers.get('etag'), '"etag-audio"');
	assert.equal(response.headers.get('accept-ranges'), 'bytes');
});