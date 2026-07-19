/**
 * Client-side markdown entry that keeps the heavy unified/katex/highlight
 * pipeline out of the initial chat route chunk.
 */

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

type MarkdownRenderer = (markdown: string) => string;

let renderer: MarkdownRenderer = (markdown) => (markdown ? escapeHtml(markdown) : '');
let loadPromise: Promise<MarkdownRenderer> | null = null;

export function renderMarkdownDeferred(markdown: string): string {
	return renderer(markdown);
}

export function ensureMarkdownRenderer(): Promise<MarkdownRenderer> {
	if (!loadPromise) {
		loadPromise = (async () => {
			const mod = await import('./markdown.ts');
			if (typeof document !== 'undefined') {
				await import('./markdown-styles.ts');
			}
			renderer = mod.renderMarkdown;
			return renderer;
		})();
	}

	return loadPromise;
}
