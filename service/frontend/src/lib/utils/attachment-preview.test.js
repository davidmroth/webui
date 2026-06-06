import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMarkdownPreviewDocument } from './attachment-preview.ts';

test('buildMarkdownPreviewDocument wraps rendered markdown in a standalone preview document', () => {
	const document = buildMarkdownPreviewDocument('# Decision\n\n- fast\n- visible', 'decision.md');

	assert.match(document, /<title>decision\.md<\/title>/);
	assert.match(document, /<p class="preview-meta">Markdown preview<\/p>/);
	assert.match(document, /<article class="markdown-content"><h1>Decision<\/h1>/);
	assert.match(document, /<li>fast<\/li>/);
	assert.match(document, /<li>visible<\/li>/);
});

test('buildMarkdownPreviewDocument escapes the document title', () => {
	const document = buildMarkdownPreviewDocument('hello', 'unsafe"<doc>.md');

	assert.match(document, /<title>unsafe&quot;&lt;doc&gt;\.md<\/title>/);
});