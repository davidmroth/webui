import test from 'node:test';
import assert from 'node:assert/strict';

import { ensureMarkdownRenderer, renderMarkdownDeferred } from './markdown-client.ts';

test('renderMarkdownDeferred escapes until the heavy renderer loads', () => {
	const html = renderMarkdownDeferred('Use <b>bold</b> & $$x$$');
	assert.equal(html, 'Use &lt;b&gt;bold&lt;/b&gt; &amp; $$x$$');
});

test('ensureMarkdownRenderer upgrades deferred rendering to full markdown', async () => {
	const render = await ensureMarkdownRenderer();
	const html = render('Compute $$x^2$$ quickly.');
	assert.match(html, /katex/);
	assert.equal(renderMarkdownDeferred('Compute $$x^2$$ quickly.'), html);
});
