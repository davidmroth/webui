import test from 'node:test';
import assert from 'node:assert/strict';
import { renderBriefingBootShell } from './briefing-boot-shell.ts';

test('renderBriefingBootShell includes spinner and render=full fetch', () => {
	const html = renderBriefingBootShell();
	assert.match(html, /briefing-boot-spinner/);
	assert.match(html, /Loading briefing/);
	assert.match(html, /render', 'full'/);
	assert.match(html, /document\.write\(html\)/);
});
