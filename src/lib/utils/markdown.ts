import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import rehypeStringify from 'rehype-stringify';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

const processor = unified()
	.use(remarkParse)
	.use(remarkGfm)
	.use(remarkBreaks)
	.use(remarkMath)
	.use(remarkRehype)
	.use(rehypeKatex)
	.use(rehypeHighlight, { detect: true, ignoreMissing: true })
	.use(rehypeStringify);

/**
 * Render a markdown string to sanitized HTML.
 * Raw HTML inside the markdown is dropped by remark-rehype's defaults,
 * so the output is safe to inject via {@html}.
 */
export function renderMarkdown(markdown: string): string {
	if (!markdown) {
		return '';
	}

	try {
		return String(processor.processSync(markdown));
	} catch {
		return escapeHtml(markdown);
	}
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}
