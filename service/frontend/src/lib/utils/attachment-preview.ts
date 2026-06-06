import { renderMarkdown } from '$lib/utils/markdown';

const MARKDOWN_PREVIEW_STYLES = `:root {
	color-scheme: light dark;
	font-family: 'SF Pro Text', 'Inter', system-ui, sans-serif;
	line-height: 1.6;
	background: #f5f1e8;
	color: #1f140b;
}
body {
	margin: 0;
	min-height: 100vh;
	background:
		radial-gradient(circle at top left, rgba(175, 108, 34, 0.14), transparent 34%),
		linear-gradient(180deg, #f7f3eb 0%, #efe5d5 100%);
	color: inherit;
}
main {
	box-sizing: border-box;
	width: min(960px, calc(100vw - 2rem));
	margin: 0 auto;
	padding: 2.5rem 0 4rem;
}
.preview-shell {
	padding: 1.5rem clamp(1rem, 2vw, 1.8rem);
	border: 1px solid rgba(79, 52, 21, 0.12);
	border-radius: 20px;
	background: rgba(255, 252, 247, 0.88);
	box-shadow: 0 20px 60px rgba(61, 40, 15, 0.12);
	backdrop-filter: blur(12px);
}
.preview-meta {
	margin: 0 0 1rem;
	font-size: 0.78rem;
	font-weight: 700;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: #8a5c25;
}
.markdown-content > *:first-child { margin-top: 0; }
.markdown-content > *:last-child { margin-bottom: 0; }
.markdown-content p,
.markdown-content ul,
.markdown-content ol,
.markdown-content pre,
.markdown-content table,
.markdown-content blockquote { margin: 0 0 1rem; }
.markdown-content h1,
.markdown-content h2,
.markdown-content h3,
.markdown-content h4 { line-height: 1.2; margin: 0 0 0.9rem; }
.markdown-content h1 { font-size: clamp(2rem, 4vw, 2.8rem); }
.markdown-content h2 { font-size: clamp(1.55rem, 3vw, 2.05rem); }
.markdown-content h3 { font-size: 1.3rem; }
.markdown-content h4 { font-size: 1.08rem; }
.markdown-content a { color: #0b63ce; }
.markdown-content code {
	padding: 0.1rem 0.32rem;
	border-radius: 0.35rem;
	background: rgba(82, 56, 24, 0.09);
	font-family: 'SFMono-Regular', 'SF Mono', ui-monospace, monospace;
	font-size: 0.92em;
}
.markdown-content pre {
	overflow-x: auto;
	padding: 1rem;
	border-radius: 0.9rem;
	background: #20160f;
	color: #f9f5ee;
}
.markdown-content pre code {
	padding: 0;
	background: transparent;
	color: inherit;
}
.markdown-content blockquote {
	padding: 0.15rem 0 0.15rem 1rem;
	border-left: 4px solid rgba(138, 92, 37, 0.28);
	color: rgba(31, 20, 11, 0.78);
}
.markdown-content table {
	width: 100%;
	border-collapse: collapse;
	overflow: hidden;
	border-radius: 0.9rem;
}
.markdown-content th,
.markdown-content td {
	padding: 0.7rem 0.85rem;
	border: 1px solid rgba(79, 52, 21, 0.12);
	text-align: left;
}
.markdown-content th { background: rgba(138, 92, 37, 0.08); }
@media (prefers-color-scheme: dark) {
	:root {
		background: #16120f;
		color: #f1e5d5;
	}
	body {
		background:
			radial-gradient(circle at top left, rgba(195, 142, 69, 0.18), transparent 32%),
			linear-gradient(180deg, #1c1713 0%, #100d0a 100%);
	}
	.preview-shell {
		border-color: rgba(239, 208, 170, 0.14);
		background: rgba(24, 19, 15, 0.88);
		box-shadow: 0 24px 60px rgba(0, 0, 0, 0.34);
	}
	.preview-meta { color: #e9b064; }
	.markdown-content a { color: #8ec5ff; }
	.markdown-content code { background: rgba(255, 255, 255, 0.08); }
	.markdown-content blockquote {
		border-left-color: rgba(233, 176, 100, 0.35);
		color: rgba(241, 229, 213, 0.82);
	}
	.markdown-content th,
	.markdown-content td { border-color: rgba(239, 208, 170, 0.12); }
	.markdown-content th { background: rgba(233, 176, 100, 0.12); }
}`;

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

export function buildMarkdownPreviewDocument(markdown: string, fileName: string): string {
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>${escapeHtml(fileName)}</title>
		<style>${MARKDOWN_PREVIEW_STYLES}</style>
	</head>
	<body>
		<main>
			<section class="preview-shell">
				<p class="preview-meta">Markdown preview</p>
				<article class="markdown-content">${renderMarkdown(markdown)}</article>
			</section>
		</main>
	</body>
</html>`;
}