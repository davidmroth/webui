import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import rehypeStringify from 'rehype-stringify';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

const LINK_REL = 'noopener noreferrer';
const BRIEFING_PATH_PATTERN = /\/briefings\/[A-Za-z0-9._~%-]+(?:\/player)?/g;
const BRIEFING_INLINE_CODE_PATTERN = /^\/briefings\/[A-Za-z0-9._~%-]+(?:\/player)?$/;

const processor = unified()
	.use(remarkParse)
	.use(remarkGfm)
	.use(remarkBreaks)
	// Keep math rendering, but require explicit math fences (e.g. $$...$$)
	// so currency like $150/month is rendered as plain text.
	.use(remarkMath, { singleDollarTextMath: false })
	.use(remarkLinkifyBriefingPaths)
	.use(remarkRehype)
	.use(rehypeKatex)
	// `detect: false` keeps the common language set without the larger
	// auto-detect table; fenced blocks still get language-aware highlighting.
	.use(rehypeHighlight, { detect: false, ignoreMissing: true })
	.use(rehypeOpenLinksInNewWindow)
	.use(rehypeStringify);

type MarkdownNode = {
	type?: unknown;
	value?: unknown;
	url?: unknown;
	children?: MarkdownNode[];
};

function remarkLinkifyBriefingPaths() {
	return (tree: unknown) => {
		linkifyBriefingPaths(tree);
	};
}

function linkifyBriefingPaths(node: unknown) {
	if (!node || typeof node !== 'object') {
		return;
	}

	const element = node as MarkdownNode;
	if (!Array.isArray(element.children)) {
		return;
	}

	element.children = element.children.flatMap(rewriteMarkdownNode);

	for (const child of element.children) {
		if (child.type === 'link') {
			continue;
		}

		linkifyBriefingPaths(child);
	}
}

function rewriteMarkdownNode(node: MarkdownNode): MarkdownNode[] {
	if (node.type === 'text' && typeof node.value === 'string') {
		return splitTextWithBriefingLinks(node.value);
	}

	if (node.type === 'inlineCode' && typeof node.value === 'string') {
		if (BRIEFING_INLINE_CODE_PATTERN.test(node.value)) {
			return [createLinkNode(node.value)];
		}
	}

	return [node];
}

function splitTextWithBriefingLinks(value: string): MarkdownNode[] {
	const matches = Array.from(value.matchAll(BRIEFING_PATH_PATTERN));
	if (matches.length === 0) {
		return [{ type: 'text', value }];
	}

	const nodes: MarkdownNode[] = [];
	let cursor = 0;

	for (const match of matches) {
		const path = match[0];
		const index = match.index ?? -1;
		if (index < 0) {
			continue;
		}

		if (index > cursor) {
			nodes.push({ type: 'text', value: value.slice(cursor, index) });
		}

		nodes.push(createLinkNode(path));
		cursor = index + path.length;
	}

	if (cursor < value.length) {
		nodes.push({ type: 'text', value: value.slice(cursor) });
	}

	return nodes;
}

function createLinkNode(url: string): MarkdownNode {
	return {
		type: 'link',
		url,
		children: [{ type: 'text', value: url }]
	};
}

function rehypeOpenLinksInNewWindow() {
	return (tree: unknown) => {
		visitNode(tree);
	};
}

function visitNode(node: unknown) {
	if (!node || typeof node !== 'object') {
		return;
	}

	const element = node as {
		tagName?: unknown;
		properties?: Record<string, unknown>;
		children?: unknown[];
	};

	if (element.tagName === 'a') {
		element.properties = {
			...element.properties,
			target: '_blank',
			rel: LINK_REL
		};
	}

	for (const child of element.children ?? []) {
		visitNode(child);
	}
}

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
