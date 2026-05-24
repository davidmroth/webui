import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchBriefingAsset, loadBriefingPreview } from './briefings.ts';

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

test('loadBriefingPreview prefers the DB-canonical artifact when a version is available', async () => {
	const preview = await loadBriefingPreview('briefing-db-123', {
		getBriefingRecordByIdentifierFn: async () => ({
			jobId: 'job-db-123',
			ownerUserId: 'user-1',
			conversationId: 'conv-1',
			sourceMessageId: 'msg-1',
			briefingId: 'briefing-db-123',
			title: 'Stored Briefing',
			summary: 'Stored summary',
			state: 'ready',
			stage: 'completed',
			manifestStorageKey: null,
			statusStorageKey: null,
			errorMessage: null,
			validationValid: true,
			validationWarningCount: 0,
			validationErrorCount: 0,
			createdAt: '2026-05-22T08:00:00Z',
			updatedAt: '2026-05-22T08:00:00Z',
			startedAt: '2026-05-22T08:00:00Z',
			completedAt: '2026-05-22T08:00:05Z',
			failedAt: null
		}),
		getLatestBriefingVersionFn: async () => ({
			id: 1,
			jobId: 'job-db-123',
			versionNumber: 1,
			artifactSchemaVersion: 'briefing-document/v1',
			artifact: {
				schemaVersion: 'briefing-document/v1',
				jobId: 'job-db-123',
				briefingId: 'briefing-db-123',
				title: 'DB Briefing',
				topic: 'DB-backed preview',
				summary: 'Loaded from the database.',
				generatedAt: '2026-05-22T08:00:00Z',
				locale: 'en-US',
				generatedBy: 'hermes',
				validation: { valid: true, warnings: [], errors: [] },
				assets: [{ role: 'audio', path: 'audio.mp3', url: '', contentType: 'audio/mpeg', sizeBytes: 12, sha256: 'a', cacheControl: 'private, max-age=300' }],
				audioAsset: { role: 'audio', path: 'audio.mp3', url: '', contentType: 'audio/mpeg', sizeBytes: 12, sha256: 'a', cacheControl: 'private, max-age=300' },
				sections: [],
				sources: [],
				timelineCues: []
			},
			provenance: null,
			creationReason: 'initial_generation',
			createdByProvider: 'openai',
			createdByModel: 'gpt-test',
			createdAt: '2026-05-22T08:00:05Z'
		}),
		readObjectBuffer: async () => {
			throw new Error('DB canonical artifacts should bypass object storage manifest reads.');
		}
	});

	assert.equal(preview.state, 'ready');
	assert.equal(preview.jobId, 'job-db-123');
	assert.equal(preview.title, 'DB Briefing');
	assert.equal(preview.audioAsset?.url, '/api/briefings/job-db-123/assets/audio.mp3');
	assert.equal(preview.exportHtmlAsset?.url, '/briefings/job-db-123');
});

test('loadBriefingPreview respects canonical processing state even when a version already exists', async () => {
	const preview = await loadBriefingPreview('job-db-processing', {
		getBriefingRecordByIdentifierFn: async () => ({
			jobId: 'job-db-processing',
			ownerUserId: 'user-1',
			conversationId: 'conv-1',
			sourceMessageId: 'msg-1',
			briefingId: 'briefing-db-processing',
			title: 'DB Briefing',
			summary: 'Still rendering',
			state: 'processing',
			stage: 'encoding_audio',
			progressPercent: 58,
			progressDetail: 'Encoding the refreshed audio track.',
			sentenceTotal: 59,
			sentenceCompleted: 12,
			manifestStorageKey: null,
			statusStorageKey: null,
			errorMessage: null,
			validationValid: true,
			validationWarningCount: 0,
			validationErrorCount: 0,
			createdAt: '2026-05-22T08:00:00Z',
			updatedAt: '2026-05-22T08:00:00Z',
			startedAt: '2026-05-22T08:00:00Z',
			completedAt: null,
			failedAt: null
		}),
		getLatestBriefingVersionFn: async () => ({
			id: 1,
			jobId: 'job-db-processing',
			versionNumber: 3,
			artifactSchemaVersion: 'briefing-document/v1',
			artifact: {
				schemaVersion: 'briefing-document/v1',
				jobId: 'job-db-processing',
				briefingId: 'briefing-db-processing',
				title: 'DB Briefing',
				topic: 'Topic',
				summary: 'Still rendering',
				generatedAt: '2026-05-22T08:00:00Z',
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
			createdAt: '2026-05-22T08:00:05Z'
		}),
		readObjectBuffer: async () => {
			throw new Error('Processing canonical briefings should not fall back to object storage.');
		}
	});

	assert.equal(preview.state, 'processing');
	assert.equal(preview.renderProgress?.stage, 'encoding_audio');
	assert.equal(preview.renderProgress?.percent, 58);
	assert.equal(preview.renderProgress?.sentenceTotal, 59);
	assert.equal(preview.renderProgress?.sentenceCompleted, 12);
	assert.match(preview.renderProgress?.detail ?? '', /encoding the refreshed audio/i);
});

test('loadBriefingPreview uses DB-authoritative processing metadata without reading status.json', async () => {
	const preview = await loadBriefingPreview('job-legacy-processing', {
		getBriefingRecordByIdentifierFn: async () => ({
			jobId: 'job-legacy-processing',
			ownerUserId: 'user-1',
			conversationId: 'conv-1',
			sourceMessageId: 'msg-1',
			briefingId: 'briefing-legacy-processing',
			title: 'Legacy Briefing',
			summary: 'Still rendering',
			state: 'processing',
			stage: 'rendering_narration',
			progressPercent: 32,
			progressDetail: 'The renderer is narrating the saved canonical briefing.',
			sentenceTotal: null,
			sentenceCompleted: null,
			manifestStorageKey: null,
			statusStorageKey: null,
			errorMessage: null,
			validationValid: true,
			validationWarningCount: 0,
			validationErrorCount: 0,
			createdAt: '2026-05-22T08:00:00Z',
			updatedAt: '2026-05-22T08:00:00Z',
			startedAt: '2026-05-22T08:00:00Z',
			completedAt: null,
			failedAt: null
		}),
		getLatestBriefingVersionFn: async () => null,
		readObjectBuffer: async () => {
			throw new Error('DB-authoritative briefing status should not read status.json.');
		}
	});

	assert.equal(preview.state, 'processing');
	assert.equal(preview.renderProgress?.stage, 'rendering_narration');
	assert.equal(preview.renderProgress?.percent, 32);
	assert.match(preview.renderProgress?.detail ?? '', /saved canonical briefing/i);
});

test('fetchBriefingAsset can read audio directly from object storage without a stored manifest', async () => {
	const response = await fetchBriefingAsset('job-audio-only', 'audio.mp3', {
		readObjectBuffer: async (storageKey) => {
			if (storageKey === 'webui/briefings/job-audio-only/briefing.json') {
				throw Object.assign(new Error('NoSuchKey'), { code: 'NoSuchKey' });
			}
			assert.equal(storageKey, 'webui/briefings/job-audio-only/audio.mp3');
			return Buffer.from('ABCDEFGHIJ', 'utf-8');
		}
	});

	assert.equal(response.status, 200);
	assert.equal(response.headers.get('content-type'), 'audio/mpeg');
	assert.equal(await response.text(), 'ABCDEFGHIJ');
});

test('loadBriefingPreview returns DB processing status when the bundle is missing', async () => {
	const preview = await loadBriefingPreview('job-processing-123', {
		getBriefingRecordByIdentifierFn: async () => ({
			jobId: 'job-processing-123',
			ownerUserId: 'user-1',
			conversationId: 'conv-1',
			sourceMessageId: 'msg-1',
			briefingId: 'briefing-processing-123',
			title: 'Stored Briefing',
			summary: 'Packaging',
			state: 'processing',
			stage: 'packaging_assets',
			progressPercent: 97,
			progressDetail: 'Writing packaged briefing assets.',
			sentenceTotal: 59,
			sentenceCompleted: 59,
			manifestStorageKey: null,
			statusStorageKey: null,
			errorMessage: null,
			validationValid: true,
			validationWarningCount: 0,
			validationErrorCount: 0,
			createdAt: '2026-05-13T17:03:53.185024+00:00',
			updatedAt: '2026-05-13T17:04:30.000000+00:00',
			startedAt: '2026-05-13T17:03:53.185024+00:00',
			completedAt: null,
			failedAt: null
		}),
		getLatestBriefingVersionFn: async () => null,
		readObjectBuffer: async () => {
			throw new Error('DB-authoritative briefing status should not read status.json.');
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

test('loadBriefingPreview reports publish-pending progress from DB when the manifest is still missing', async () => {
	const preview = await loadBriefingPreview('job-prod-fail', {
		getBriefingRecordByIdentifierFn: async () => ({
			jobId: 'job-prod-fail',
			ownerUserId: 'user-1',
			conversationId: 'conv-1',
			sourceMessageId: 'msg-1',
			briefingId: 'briefing-prod-fail',
			title: 'Stored Briefing',
			summary: 'Publishing',
			state: 'processing',
			stage: 'publishing_bundle',
			progressPercent: 100,
			progressDetail: 'Briefing ready.',
			sentenceTotal: null,
			sentenceCompleted: null,
			manifestStorageKey: null,
			statusStorageKey: null,
			errorMessage: null,
			validationValid: true,
			validationWarningCount: 0,
			validationErrorCount: 0,
			createdAt: '2026-05-13T17:03:53.185024+00:00',
			updatedAt: '2026-05-13T17:05:53.185024+00:00',
			startedAt: '2026-05-13T17:03:53.185024+00:00',
			completedAt: null,
			failedAt: null
		}),
		getLatestBriefingVersionFn: async () => null,
		readObjectBuffer: async (storageKey) => {
			if (storageKey === 'webui/briefings/job-prod-fail/briefing.json') {
				throw Object.assign(new Error('NoSuchKey'), { code: 'NoSuchKey' });
			}
			throw new Error(`Unexpected storage read: ${storageKey}`);
		},
		now: Date.parse('2026-05-13T17:09:00.000Z')
	});

	assert.equal(preview.state, 'processing');
	assert.equal(preview.status, 'processing');
	assert.equal(preview.renderProgress?.stage, 'publishing_bundle');
	assert.equal(preview.renderProgress?.percent, 100);
	assert.match(preview.renderProgress?.detail ?? '', /briefing ready|published bundle|object storage/i);
	assert.doesNotMatch(preview.renderProgress?.detail ?? '', /BRIEFING_RENDERER_/);
});

test('loadBriefingPreview fails closed when publishing stays incomplete after the timeout window in DB state', async () => {
	const preview = await loadBriefingPreview('job-publish-timeout', {
		getBriefingRecordByIdentifierFn: async () => ({
			jobId: 'job-publish-timeout',
			ownerUserId: 'user-1',
			conversationId: 'conv-1',
			sourceMessageId: 'msg-1',
			briefingId: 'briefing-publish-timeout',
			title: 'Stored Briefing',
			summary: 'Publishing',
			state: 'processing',
			stage: 'publishing_bundle',
			progressPercent: 100,
			progressDetail: 'Briefing ready.',
			sentenceTotal: null,
			sentenceCompleted: null,
			manifestStorageKey: null,
			statusStorageKey: null,
			errorMessage: null,
			validationValid: true,
			validationWarningCount: 0,
			validationErrorCount: 0,
			createdAt: '2026-05-13T17:03:53.185024+00:00',
			updatedAt: '2026-05-13T17:05:53.185024+00:00',
			startedAt: '2026-05-13T17:03:53.185024+00:00',
			completedAt: null,
			failedAt: null
		}),
		getLatestBriefingVersionFn: async () => null,
		readObjectBuffer: async (storageKey) => {
			if (storageKey === 'webui/briefings/job-publish-timeout/briefing.json') {
				throw Object.assign(new Error('NoSuchKey'), { code: 'NoSuchKey' });
			}
			throw new Error(`Unexpected storage read: ${storageKey}`);
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