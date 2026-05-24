import test from 'node:test';
import assert from 'node:assert/strict';

import { queueBriefingRegenerationRequest } from './briefing-regenerate.ts';

test('queueBriefingRegenerationRequest enqueues a structured Hermes request from saved provenance', async () => {
	let capturedContent = '';
	const queued = await queueBriefingRegenerationRequest(
		'user-1',
		'job-1',
		['Shorten the opening section'],
		{
			getBriefingRecordFn: async () => ({
				jobId: 'job-1',
				ownerUserId: 'user-1',
				conversationId: 'conv-1',
				sourceMessageId: 'msg-1',
				briefingId: 'briefing-1',
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
				jobId: 'job-1',
				versionNumber: 2,
				artifactSchemaVersion: 'briefing-document/v1',
				artifact: {
					schemaVersion: 'briefing-document/v1',
					jobId: 'job-1',
					briefingId: 'briefing-1',
					title: 'Stored Briefing',
					topic: 'Macro outlook',
					summary: 'Stored summary',
					generatedAt: '2026-05-22T08:00:00Z',
					locale: 'en-US',
					generatedBy: 'hermes',
					validation: { valid: true, warnings: [], errors: [] },
					assets: [],
					audioAsset: null,
					sections: [],
					sources: [{ id: 's1', title: 'Fed note', publisher: 'Fed', url: 'https://example.com/fed', accessedAt: null, excerpt: null }],
					timelineCues: []
				},
				provenance: {
					schemaVersion: 'briefing-provenance/v1',
					originalPrompt: 'Create a macro briefing',
					systemPrompt: 'Use concise institutional language',
					requestedChanges: [],
					sourceSummary: 'Fed and CPI sources',
					sourceUrls: ['https://example.com/fed'],
					provider: 'openai',
					model: 'gpt-test',
					conversationId: 'conv-1',
					sourceMessageId: 'msg-1',
					toolName: 'create_briefing',
					metadata: {}
				},
				creationReason: 'initial_generation',
				createdByProvider: 'openai',
				createdByModel: 'gpt-test',
				createdAt: '2026-05-22T08:00:05Z'
			}),
			enqueueUserMessageFn: async (_userId, conversationId, content) => {
				capturedContent = content;
				assert.equal(conversationId, 'conv-1');
				return { messageId: 'msg-regen', eventId: 'evt-regen' };
			}
		}
	);

	assert.equal(queued?.conversationId, 'conv-1');
	assert.match(capturedContent, /regenerate_briefing tool/);
	assert.match(capturedContent, /Original prompt: Create a macro briefing/);
	assert.match(capturedContent, /Shorten the opening section/);
	assert.match(capturedContent, /https:\/\/example.com\/fed/);
});