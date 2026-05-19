import {
	standaloneManagementCss,
	standaloneManagementScript
} from './briefing-standalone-management-assets';
import { standalonePageBaseCss } from './briefing-standalone-page-css';
import {
	standalonePlayerDockCss,
	standalonePlayerDockScript
} from './briefing-standalone-player-dock-assets';

function encodeAssetPath(assetPath: string) {
	return assetPath
		.split('/')
		.map((segment) => encodeURIComponent(segment))
		.join('/');
}

function buildAssetUrl(jobId: string, assetPath: string) {
	return `/api/briefings/${encodeURIComponent(jobId)}/assets/${encodeAssetPath(assetPath)}`;
}

interface StandaloneManagementOptions {
	canManage: boolean;
	isPublic: boolean;
	standalonePath: string;
}

function escapeAttribute(value: string) {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('"', '&quot;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;');
}

function renderInlineStyle(css: string, attributes = '') {
	return `<style${attributes}>${css}</style>`;
}

function renderInlineScript(script: string) {
	return `<script>${script}</script>`;
}

function buildManagementBar(jobId: string, options: StandaloneManagementOptions) {
	const buttonLabel = options.isPublic ? 'Make private' : 'Make public';
	const statusLabel = options.isPublic ? 'HTML export is public' : 'HTML export is private';
	const statusDescription = options.isPublic
		? 'Anyone with this link can open it.'
		: 'Authentication is required until you explicitly make this export public.';

	return `
<aside id="briefing-share-manager" data-job-id="${escapeAttribute(jobId)}" data-public="${options.isPublic ? 'true' : 'false'}" data-standalone-path="${escapeAttribute(options.standalonePath)}">
	${renderInlineStyle(standaloneManagementCss)}
	<button type="button" id="briefing-share-launcher" aria-haspopup="dialog" aria-expanded="false">Manage access</button>
	<div id="briefing-share-dialog" aria-hidden="true">
		<section id="briefing-share-panel" role="dialog" aria-modal="true" aria-labelledby="briefing-share-title">
			<div id="briefing-share-panel-header">
				<div class="share-manager-copy">
					<div class="share-manager-kicker">Access</div>
					<div class="share-manager-status" id="briefing-share-title">${statusLabel}</div>
					<div class="share-manager-detail">${statusDescription}</div>
				</div>
				<button type="button" id="briefing-share-close" aria-label="Close access panel">×</button>
			</div>
			<div class="share-manager-actions">
				<button type="button" id="share-toggle-button">${buttonLabel}</button>
				<button type="button" id="share-copy-button" class="secondary">Copy link</button>
			</div>
			<div id="share-manager-message" class="share-manager-message" aria-live="polite"></div>
		</section>
	</div>
	${renderInlineScript(standaloneManagementScript)}
</aside>`;
}

function injectManagementBar(html: string, jobId: string, options?: StandaloneManagementOptions) {
	if (!options?.canManage) {
		return html;
	}

	const managementBar = buildManagementBar(jobId, options);
	if (/<body[^>]*>/i.test(html)) {
		return html.replace(/<body([^>]*)>/i, `<body$1>${managementBar}`);
	}

	return `${managementBar}${html}`;
}

function buildStandalonePlayerDock() {
	return `
${renderInlineStyle(standalonePlayerDockCss, ' id="webui-standalone-player-dock"')}

${renderInlineScript(standalonePlayerDockScript)}`;
}

function injectStandalonePlayerDock(html: string) {
	const dock = buildStandalonePlayerDock();
	if (/<\/body>/i.test(html)) {
		return html.replace(/<\/body>/i, `${dock}</body>`);
	}

	return `${html}${dock}`;
}

// ─── Page generation from manifest data ──────────────────────────────────────

interface BriefingPageMetricCard {
	id: string;
	label: string;
	value: string;
	trend: string | null;
	cue: { start: number; end: number } | null;
}

interface BriefingPageSentenceSpan {
	text: string;
	start: number;
	end: number;
	cue?: { start: number; end: number } | null;
}

interface BriefingPageSection {
	id: string;
	title: string;
	body: string[];
	narration?: string;
	sentences?: BriefingPageSentenceSpan[];
	metrics: BriefingPageMetricCard[];
	start: number;
	end: number;
	cue: { start: number; end: number } | null;
}

interface BriefingPageSource {
	id: string;
	title: string;
	publisher: string;
	url: string;
}

interface BriefingPageData {
	title: string;
	topic?: string;
	generatedAt?: string;
	locale: string;
	audioUrl: string;
	sections: BriefingPageSection[];
	sources: BriefingPageSource[];
}

function escapeHtml(value: string) {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

function formatSeconds(sec: number): string {
	const total = Math.floor(sec);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	if (h > 0) return `${h}h ${m}m ${s}s`;
	if (m > 0) return `${m}m ${s}s`;
	return `${s}s`;
}

function renderMetricCards(metrics: BriefingPageMetricCard[]): string {
	if (!metrics.length) return '';
	const cards = metrics.map((m) => {
		const cueAttrs = m.cue ? ` data-start="${m.cue.start}" data-end="${m.cue.end}"` : '';
		const trend = m.trend ? `<div style="margin-top:.15rem">${escapeHtml(m.trend)}</div>` : '';
		return `<div class="metric-badge" id="${escapeAttribute(m.id)}"${cueAttrs}><div class="metric-label">${escapeHtml(m.label)}</div><div class="metric-value">${escapeHtml(m.value)}</div>${trend}</div>`;
	});
	return `<div class="metrics-display">${cards.join('')}</div>`;
}


function splitNarrationIntoParagraphs(narration: string): string[] {
	return narration
		.split(/\n\s*\n/)
		.map((paragraph) => paragraph.trim())
		.filter(Boolean);
}

function resolveSectionParagraphs(section: BriefingPageSection): string[] {
	if (section.body.length > 0) {
		return section.body;
	}

	const narration = typeof section.narration === 'string' ? section.narration.trim() : '';
	if (narration) {
		return splitNarrationIntoParagraphs(narration);
	}

	if (Array.isArray(section.sentences) && section.sentences.length > 0) {
		const sentenceCopy = section.sentences
			.map((sentence) => sentence.text.trim())
			.filter(Boolean)
			.join(' ')
			.trim();
		return sentenceCopy ? [sentenceCopy] : [];
	}

	return [];
}

function renderSentenceCopy(section: BriefingPageSection): string {
	if (!Array.isArray(section.sentences) || section.sentences.length === 0) {
		return '';
	}

	const sentenceHtml = section.sentences
		.map((sentence) => {
			const cueStart = sentence.cue?.start ?? sentence.start;
			const cueEnd = sentence.cue?.end ?? sentence.end;
			return `<span class="section-sentence" data-start="${cueStart}" data-end="${cueEnd}" tabindex="0" role="button">${escapeHtml(sentence.text)}</span>`;
		})
		.join(' ');

	return `<div class="section-body"><p>${sentenceHtml}</p>${renderMetricCards(section.metrics)}</div>`;
}

function renderPageSection(idx: number, section: BriefingPageSection): string {
	const sectionNum = String(idx + 1).padStart(2, '0');
	const cueAttrs = section.cue
		? ` data-start="${section.cue.start}" data-end="${section.cue.end}"`
		: section.start != null
			? ` data-start="${section.start}" data-end="${section.end}"`
			: '';
	const timing = section.start != null ? `Narration cue ${formatSeconds(section.start)} to ${formatSeconds(section.end)}` : '';
	const headerHtml = `<div class="section-header">
		<div>
			<h2 class="section-meta">SECTION ${sectionNum}</h2>
			<h3 class="section-heading" style="margin-top:.5rem">${escapeHtml(section.title)}</h3>
		</div>
		${timing ? `<div class="section-timing">${escapeHtml(timing)}</div>` : ''}
	</div>`;

	const sentenceBodyHtml = renderSentenceCopy(section);
	const paragraphs = sentenceBodyHtml ? [] : resolveSectionParagraphs(section);
	const paragraphBodyHtml = paragraphs.length
		? `<div class="section-body">${paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('\n')}${renderMetricCards(section.metrics)}</div>`
		: '';
	const bodyHtml = sentenceBodyHtml || paragraphBodyHtml;

	return `<section class="section-card" id="section-${idx}"${cueAttrs}>${headerHtml}${bodyHtml}</section>`;
}

function renderSectionNavigation(sections: BriefingPageSection[]): string {
	const items = sections
		.map((s, i) => {
			const sectionNum = String(i + 1).padStart(2, '0');
			const timing = s.start != null ? formatSeconds(s.start) : '—';
			return `<li class="article-nav-item"><a href="#section-${i}" data-section-num="${sectionNum}"><span class="article-nav-label">${sectionNum} ${escapeHtml(s.title)}</span><span class="article-nav-time">${timing}</span></a></li>`;
		})
		.join('');
	return `<aside class="article-rail"><nav class="article-nav">
		<h2 class="article-nav-title">Article navigation</h2>
		<ul class="article-nav-list">${items}</ul>
	</nav></aside>`;
}

function renderPageSources(sources: BriefingPageSource[]): string {
	if (!sources.length) return '';
	const items = sources
		.map((s) => `<a href="${escapeAttribute(s.url)}" class="source-link" target="_blank" rel="noopener noreferrer">
			<span class="source-title">${escapeHtml(s.title)}</span>
			<span class="source-publisher">${escapeHtml(s.publisher)}</span>
		</a>`)
		.join('');
	return `<section><h2 class="sources-heading">Sources</h2><div class="sources-list">${items}</div></section>`;
}

export function buildBriefingPageHtml(data: BriefingPageData, jobId: string, options?: StandaloneManagementOptions): string {
	const navHtml = renderSectionNavigation(data.sections);
	const sectionsHtml = data.sections.map((s, i) => renderPageSection(i, s)).join('\n');
	const sourcesHtml = renderPageSources(data.sources);

	const html = `<!DOCTYPE html>
<html lang="${escapeAttribute(data.locale ?? 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(data.title)}</title>
<style>${standalonePageBaseCss}</style>
</head>
<body>
<main class="page-shell">
<section class="hero">
<div class="hero-eyebrow">Briefing</div>
<h1 class="hero-title">${escapeHtml(data.title)}</h1>
<p class="hero-subtitle">${escapeHtml(data.topic || data.title)}</p>
<div class="hero-audio" data-sticky-player>
<div class="hero-audio-player">
<div class="hero-audio-label">Narration</div>
<audio controls preload="auto" data-briefing-audio>
<source src="${escapeAttribute(data.audioUrl)}" type="audio/mpeg" />
</audio>
</div>
</div>
</section>
<div class="content-wrap">
${navHtml}
<article class="article-body">
<div class="briefing-metadata">
<div class="metadata-item">
<div class="metadata-label">Generated:</div>
<div class="metadata-value"><time data-generated-at="${escapeAttribute(data.generatedAt || '')}">${escapeHtml(data.generatedAt || 'Recently')}</time></div>
</div>
<div class="metadata-item">
<div class="metadata-label">Sources:</div>
<div class="metadata-value">${data.sources.length}</div>
</div>
</div>
${sectionsHtml}
${sourcesHtml}
</article>
</div>
</main>
${buildStandalonePlayerDock()}
</body>
</html>`;

	return injectManagementBar(html, jobId, options);
}

// ─── Legacy: rewrite asset URLs in renderer-generated standalone.html ─────────

export function rewriteStandaloneAssetUrls(html: string, jobId: string, options?: StandaloneManagementOptions) {
	const rewritten = html
		.replaceAll('./player.css', buildAssetUrl(jobId, 'player.css'))
		.replaceAll('./audio.mp3', buildAssetUrl(jobId, 'audio.mp3'))
		.replaceAll('./player.js', buildAssetUrl(jobId, 'player.js'))
		.replaceAll(/\.\/illustrations\/([^"'?#>]+)/g, (_match, assetName: string) => {
			return buildAssetUrl(jobId, `illustrations/${assetName}`);
		});

	return injectManagementBar(injectStandalonePlayerDock(rewritten), jobId, options);
}