import test from 'node:test';
import assert from 'node:assert/strict';

import { renderMarkdown } from './markdown.ts';

test('renderMarkdown keeps currency amounts as plain text', () => {
	const html = renderMarkdown(
		"Flat ~$150/month electricity bill instead of variable $200-400+/month."
	);

	assert.match(html, /\$150\/month electricity bill instead of variable \$200-400\+\/month\./);
	assert.doesNotMatch(html, /katex/);
});

test('renderMarkdown still renders explicit math fences', () => {
	const html = renderMarkdown('Compute $$x^2 + y^2$$ quickly.');

	assert.match(html, /katex/);
	assert.match(html, /Compute/);
});
