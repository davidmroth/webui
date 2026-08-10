import test from 'node:test';
import assert from 'node:assert/strict';

import { buildConversationUrl } from './conversation-link.ts';

test('buildConversationUrl returns a relative chat path without window', () => {
	assert.equal(buildConversationUrl('abc-123'), '/chat?conversation=abc-123');
});

test('buildConversationUrl encodes conversation ids', () => {
	assert.equal(
		buildConversationUrl('id/with spaces'),
		'/chat?conversation=id%2Fwith%20spaces'
	);
});

test('buildConversationUrl returns an absolute URL when window is available', () => {
	const previousWindow = globalThis.window;
	globalThis.window = {
		location: { origin: 'https://example.test' }
	};

	try {
		assert.equal(
			buildConversationUrl('abc-123'),
			'https://example.test/chat?conversation=abc-123'
		);
	} finally {
		if (previousWindow === undefined) {
			delete globalThis.window;
		} else {
			globalThis.window = previousWindow;
		}
	}
});
