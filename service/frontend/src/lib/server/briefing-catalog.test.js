import test from 'node:test';
import assert from 'node:assert/strict';

import { syncBriefingJobFromStorage } from './briefing-catalog.ts';

function storageJson(payload) {
	return Buffer.from(JSON.stringify(payload), 'utf-8');
}

test('syncBriefingJobFromStorage skips generated briefing assets when persisting catalog rows', async () => {
	const assetBatches = [];
	const recordInputs = [];

	const result = await syncBriefingJobFromStorage('job-sync-1', {
		defaultOwnerUserId: 'user-sync-1',
		getBriefingRecordFn: async () => null,
		queryFn: async (sql) => {
			if (sql.includes('FROM briefing_shares')) {
				return [];
			}
			if (sql.includes('SELECT id FROM users')) {
				return [{ id: 'user-sync-1' }];
			}
			return [];
		},
		readObjectBufferFn: async (storageKey) => {
			if (storageKey.endsWith('/briefing.json')) {
				return storageJson({
					job_id: 'job-sync-1',
					briefing_id: 'briefing-sync-1',
					title: 'Sync Test',
					topic: 'Generated asset filtering',
					generated_at: '2026-05-19T10:00:00Z',
					audio_path: 'audio.mp3',
					standalone_html_path: 'standalone.html',
					sections: [],
					sources: [],
					timeline_cues: [],
					assets: [
						{
							role: 'audio',
							path: 'audio.mp3',
							content_type: 'audio/mpeg',
							size_bytes: 12,
							sha256: 'a',
							cache_control: 'private, max-age=300'
						},
						{
							role: 'standalone_html',
							path: 'standalone.html',
							content_type: 'text/html; charset=utf-8',
							size_bytes: 12,
							sha256: 'b',
							cache_control: 'private, max-age=0, must-revalidate'
						},
						{
							role: 'player_css',
							path: 'player.css',
							content_type: 'text/css; charset=utf-8',
							size_bytes: 12,
							sha256: 'c',
							cache_control: 'private, max-age=300'
						},
						{
							role: 'player_js',
							path: 'player.js',
							content_type: 'application/javascript; charset=utf-8',
							size_bytes: 12,
							sha256: 'd',
							cache_control: 'private, max-age=300'
						}
					],
					validation: { valid: true, warnings: [], errors: [] }
				});
			}
			if (storageKey.endsWith('/status.json')) {
				return storageJson({
					job_id: 'job-sync-1',
					briefing_id: 'briefing-sync-1',
					status: 'completed',
					stage: 'completed',
					created_at: '2026-05-19T10:00:00Z',
					completed_at: '2026-05-19T10:01:00Z',
					asset_count: 4,
					validation: null
				});
			}
			throw new Error(`Unexpected storage key: ${storageKey}`);
		},
		upsertBriefingRecordFn: async (input) => {
			recordInputs.push(input);
			return input.jobId;
		},
		upsertBriefingAssetsFn: async (_jobId, assets) => {
			assetBatches.push(assets);
			return assets.length;
		}
	});

	assert.equal(recordInputs.length, 1);
	assert.equal(assetBatches.length, 1);
	assert.deepEqual(
		assetBatches[0].map((asset) => asset.role),
		['audio', 'manifest', 'status']
	);
	assert.deepEqual(
		assetBatches[0].map((asset) => asset.assetPath),
		['audio.mp3', 'briefing.json', 'status.json']
	);
});