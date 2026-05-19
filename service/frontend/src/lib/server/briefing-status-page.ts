import type { BriefingPreview } from '../types/briefing.ts';

type PendingBriefingPreview = Exclude<BriefingPreview, { state: 'ready' }>;

const ESTIMATED_RENDER_DURATION_MS = 75_000;
const PROGRESS_FLOOR = 12;
const PROGRESS_CEILING = 94;

const RENDERER_STAGE_COPY = {
	queued: {
		defaultPercent: 1,
		stageLabel: 'Queued for export generation',
		summary: 'The briefing has been accepted and is waiting for an export slot.',
		detail: 'Another briefing is already being processed. This job will start automatically when a slot is free.'
	},
	rendering_narration: {
		defaultPercent: 36,
		stageLabel: 'Rendering narration and timing cues',
		summary: 'The export pipeline is actively generating spoken narration for this briefing.',
		detail: 'Long narrated briefings can take several minutes on the local TTS sidecar, especially when multiple jobs are queued.'
	},
	encoding_audio: {
		defaultPercent: 84,
		stageLabel: 'Encoding the final audio track',
		summary: 'Narration is complete and the export pipeline is encoding the final audio track.',
		detail: 'The synthesized narration is being converted into the export audio asset.'
	},
	assembling_briefing: {
		defaultPercent: 92,
		stageLabel: 'Building timeline and briefing bundle',
		summary: 'The export pipeline is assembling timeline cues, validation, and HTML output.',
		detail: 'The narrated briefing bundle is being assembled from the completed audio and source data.'
	},
	packaging_assets: {
		defaultPercent: 97,
		stageLabel: 'Writing packaged assets',
		summary: 'The export pipeline is writing the final briefing assets and manifest.',
		detail: 'The export bundle is almost ready.'
	},
	publishing_bundle: {
		defaultPercent: 100,
		stageLabel: 'Publishing briefing bundle',
		summary: 'Rendering finished and the WebUI is waiting for the published briefing bundle.',
		detail: 'Object storage is catching up before the standalone export can open.'
	},
	completed: {
		defaultPercent: 100,
		stageLabel: 'Briefing ready',
		summary: 'The briefing render has completed.',
		detail: 'The exported briefing is ready to open.'
	},
	failed: {
		defaultPercent: PROGRESS_CEILING,
		stageLabel: 'Rendering failed',
		summary: 'The export pipeline reported a failure for this briefing.',
		detail: 'Check the reported error for the failed stage.'
	}
} as const;

function interpolateProgress(elapsedMs: number) {
	const checkpoints = [
		{ elapsedMs: 0, percent: PROGRESS_FLOOR },
		{ elapsedMs: 12_000, percent: 26 },
		{ elapsedMs: 28_000, percent: 48 },
		{ elapsedMs: 48_000, percent: 71 },
		{ elapsedMs: ESTIMATED_RENDER_DURATION_MS, percent: 88 },
		{ elapsedMs: ESTIMATED_RENDER_DURATION_MS * 1.5, percent: PROGRESS_CEILING }
	];

	for (let index = 1; index < checkpoints.length; index += 1) {
		const previous = checkpoints[index - 1];
		const current = checkpoints[index];
		if (elapsedMs <= current.elapsedMs) {
			const span = current.elapsedMs - previous.elapsedMs;
			const ratio = span > 0 ? (elapsedMs - previous.elapsedMs) / span : 0;
			return Math.round(previous.percent + (current.percent - previous.percent) * ratio);
		}
	}

	return PROGRESS_CEILING;
}

function estimateProgress(preview: Extract<PendingBriefingPreview, { state: 'processing' }>) {
	const createdAtMs = Date.parse(preview.createdAt);
	const elapsedMs = Number.isFinite(createdAtMs) ? Math.max(0, Date.now() - createdAtMs) : 0;

	if (preview.renderProgress) {
		const stageCopy = RENDERER_STAGE_COPY[preview.renderProgress.stage];
		const sentenceTotal = preview.renderProgress.sentenceTotal;
		const sentenceCompleted = preview.renderProgress.sentenceCompleted;

		return {
			percent: Math.max(0, Math.min(100, preview.renderProgress.percent ?? stageCopy.defaultPercent)),
			stageLabel: stageCopy.stageLabel,
			summary: stageCopy.summary,
			detail:
				typeof preview.renderProgress.detail === 'string' && preview.renderProgress.detail.trim().length > 0
					? preview.renderProgress.detail
					: stageCopy.detail,
			trailingLabel:
				typeof sentenceTotal === 'number' && sentenceTotal > 0
					? `${Math.min(sentenceTotal, Math.max(0, sentenceCompleted ?? 0))} of ${sentenceTotal} narration segments completed`
					: preview.renderProgress.stage === 'queued'
						? 'Starts automatically when a render slot is free'
						: preview.renderProgress.stage === 'publishing_bundle'
							? 'Checking for the published bundle'
						: 'Live export status'
		};
	}

	const percent = Math.max(PROGRESS_FLOOR, Math.min(PROGRESS_CEILING, interpolateProgress(elapsedMs)));
	let stageLabel = 'Preparing the briefing render';
	if (percent >= 82) {
		stageLabel = 'Running final validation and packaging';
	} else if (percent >= 58) {
		stageLabel = 'Syncing narration, cue timing, and HTML';
	} else if (percent >= 34) {
		stageLabel = 'Generating narration and timing cues';
	}

	return {
		percent,
		stageLabel,
		summary: 'Research has been completed, and the briefing is being generated.',
		detail:
			'We are rendering narration, syncing the explainer timeline, and packaging the export assets. Most briefings finish within about a minute.',
		trailingLabel: null
	};
}

function escapeHtml(value: string | null | undefined) {
	return (value ?? '')
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

function formatTimestamp(value: string | null | undefined) {
	if (!value) {
		return 'Unavailable';
	}

	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		return value;
	}

	return new Intl.DateTimeFormat('en-US', {
		dateStyle: 'medium',
		timeStyle: 'medium',
		timeZone: 'UTC'
	}).format(parsed);
}

function formatPublishReachedAt(preview: PendingBriefingPreview) {
	if (
		preview.state !== 'processing' ||
		preview.renderProgress?.stage !== 'publishing_bundle' ||
		!preview.completedAt
	) {
		return null;
	}

	return `Reached 100% at ${formatTimestamp(preview.completedAt)}`;
}

function pageTitle(preview: PendingBriefingPreview) {
	switch (preview.state) {
		case 'processing':
			return preview.renderProgress?.stage === 'publishing_bundle'
				? 'Publishing briefing'
				: 'Rendering briefing';
		case 'failed':
			return 'Briefing render failed';
		case 'missing':
			return 'Briefing not found';
		case 'error':
			return 'Briefing status unavailable';
	}
	}

function stateLabel(preview: PendingBriefingPreview) {
	switch (preview.state) {
		case 'processing':
			return preview.renderProgress?.stage === 'publishing_bundle' ? 'Publishing' : 'In progress';
		case 'failed':
			return 'Failed';
		case 'missing':
			return 'Missing';
		case 'error':
			return 'Unavailable';
	}
	}

function stateClass(preview: PendingBriefingPreview) {
	switch (preview.state) {
		case 'processing':
			return 'state-processing';
		case 'failed':
			return 'state-failed';
		case 'missing':
			return 'state-missing';
		case 'error':
			return 'state-error';
	}
	}

export function statusCodeForBriefingPreviewState(state: PendingBriefingPreview['state']) {
	switch (state) {
		case 'processing':
			return 202;
		case 'failed':
			return 409;
		case 'missing':
			return 404;
		case 'error':
		default:
			return 502;
	}
}

export function renderBriefingUnauthorizedPage(jobId: string) {
	return renderBriefingStatusPage({
		state: 'error',
		status: 'error',
		jobId,
		message: 'This standalone briefing is private.',
		detail: 'The owner has not enabled public access for this standalone export.',
		canRetry: false
	});
}

export function renderBriefingStatusPage(
	preview: PendingBriefingPreview,
	options: { retryHref?: string | null } = {}
) {
	const title = pageTitle(preview);
	const badgeLabel = stateLabel(preview);
	const badgeClass = stateClass(preview);
	const headerTitle =
		preview.state === 'missing'
			? preview.message
			: preview.state === 'error'
				? title
				: preview.briefingId ?? preview.jobId;
	const subtitle =
		preview.state === 'processing'
			? preview.renderProgress?.stage === 'publishing_bundle'
				? 'This page refreshes automatically while the published briefing bundle becomes available.'
				: 'This page refreshes automatically until the narrated briefing is ready.'
			: preview.state === 'failed'
				? 'The export pipeline accepted this job but could not finish it.'
				: preview.state === 'missing'
					? 'No published briefing export exists for this identifier.'
					: 'The WebUI could not retrieve the current briefing status.';

	const progressEstimate = preview.state === 'processing' ? estimateProgress(preview) : null;
	const publishReachedAt = formatPublishReachedAt(preview);

	const progressMarkup = progressEstimate
		? `<section class="progress-panel">
			<h2>${escapeHtml(progressEstimate.stageLabel)}</h2>
			<p class="summary">${escapeHtml(progressEstimate.summary)}</p>
			<div class="progress-bar" aria-hidden="true">
				<span style="width: ${progressEstimate.percent}%"></span>
			</div>
			<div class="progress-meta">
				<strong>${progressEstimate.percent}%</strong>
				<span>${escapeHtml(progressEstimate.trailingLabel ?? 'Working')}</span>
			</div>
			${publishReachedAt ? `<p class="detail">${escapeHtml(publishReachedAt)}</p>` : ''}
			<p class="detail">${escapeHtml(progressEstimate.detail)}</p>
		</section>`
		: '';

	const detailsMarkup =
		preview.state === 'processing' || preview.state === 'failed'
			? `<dl class="details-grid">
				<div>
					<dt>Job ID</dt>
					<dd>${escapeHtml(preview.jobId)}</dd>
				</div>
				<div>
					<dt>Briefing ID</dt>
					<dd>${escapeHtml(preview.briefingId ?? 'Unavailable')}</dd>
				</div>
				<div>
					<dt>Created</dt>
					<dd>${escapeHtml(formatTimestamp(preview.createdAt))}</dd>
				</div>
				<div>
					<dt>Completed</dt>
					<dd>${escapeHtml(formatTimestamp(preview.completedAt))}</dd>
				</div>
			</dl>`
			: `<dl class="details-grid">
				<div>
					<dt>Job ID</dt>
					<dd>${escapeHtml(preview.jobId)}</dd>
				</div>
			</dl>`;

	const calloutMarkup =
		preview.state === 'failed'
			? `<div class="callout">
				<p>${escapeHtml(preview.error ?? 'The export pipeline did not provide a specific error.')}</p>
				${preview.detail ? `<p class="detail">${escapeHtml(preview.detail)}</p>` : ''}
			</div>`
			: preview.state === 'missing'
				? `<p class="callout">${escapeHtml(preview.message)}</p>`
				: preview.state === 'error'
					? `<div class="callout">
						<p>${escapeHtml(preview.message)}</p>
						${preview.detail ? `<p class="detail">${escapeHtml(preview.detail)}</p>` : ''}
					</div>`
					: '';

	const retryActionMarkup =
		options.retryHref && ((preview.state === 'failed' && preview.canRetry) || (preview.state === 'error' && preview.canRetry))
			? `<a href="${escapeHtml(options.retryHref)}">Retry loading briefing</a>`
			: '';

	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>${escapeHtml(title)}</title>
	${preview.state === 'processing' ? '<meta http-equiv="refresh" content="3" />' : ''}
	<style>
		:root {
			color-scheme: light;
			--bg: #f3efe7;
			--panel: rgba(255, 251, 245, 0.94);
			--ink: #201b16;
			--muted: #64584b;
			--line: rgba(70, 57, 42, 0.14);
			--accent: #1f6f5f;
			--accent-soft: rgba(31, 111, 95, 0.16);
			--warn: #8b2e1f;
			--warn-soft: rgba(139, 46, 31, 0.14);
			--missing: #7a5a12;
			--missing-soft: rgba(122, 90, 18, 0.14);
			--error: #5c365f;
			--error-soft: rgba(92, 54, 95, 0.14);
		}

		* { box-sizing: border-box; }

		body {
			margin: 0;
			min-height: 100vh;
			font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif;
			background:
				radial-gradient(circle at top left, rgba(31, 111, 95, 0.18), transparent 30%),
				radial-gradient(circle at bottom right, rgba(160, 102, 53, 0.14), transparent 28%),
				linear-gradient(180deg, #f8f5ef 0%, var(--bg) 100%);
			color: var(--ink);
		}

		main {
			max-width: 880px;
			margin: 0 auto;
			padding: 48px 20px 64px;
		}

		.shell {
			background: var(--panel);
			border: 1px solid var(--line);
			border-radius: 28px;
			padding: 28px;
			box-shadow: 0 28px 80px rgba(56, 41, 26, 0.12);
			backdrop-filter: blur(12px);
		}

		.eyebrow {
			display: inline-flex;
			align-items: center;
			gap: 10px;
			padding: 8px 14px;
			border-radius: 999px;
			font: 600 0.88rem/1.1 "Avenir Next", "Segoe UI", sans-serif;
			letter-spacing: 0.04em;
			text-transform: uppercase;
			margin-bottom: 18px;
		}

		.state-processing { background: var(--accent-soft); color: var(--accent); }
		.state-failed { background: var(--warn-soft); color: var(--warn); }
		.state-missing { background: var(--missing-soft); color: var(--missing); }
		.state-error { background: var(--error-soft); color: var(--error); }

		h1 {
			margin: 0;
			font-size: clamp(2rem, 3.6vw, 3.5rem);
			line-height: 1;
			letter-spacing: -0.03em;
			overflow-wrap: anywhere;
			word-break: break-word;
			max-width: 100%;
		}

		.lead, .summary, .detail, .callout, .actions a, dt, dd {
			font-family: "Avenir Next", "Segoe UI", sans-serif;
		}

		.lead {
			margin: 14px 0 0;
			max-width: 60ch;
			font-size: 1.02rem;
			line-height: 1.6;
			color: var(--muted);
		}

		.progress-panel,
		.callout,
		.details-grid {
			margin-top: 24px;
		}

		.progress-panel {
			padding: 22px;
			border-radius: 22px;
			background: rgba(255, 255, 255, 0.72);
			border: 1px solid rgba(31, 111, 95, 0.14);
		}

		.progress-panel h2 {
			margin: 0 0 10px;
			font-size: 1.4rem;
		}

		.summary, .detail, .callout {
			margin: 0;
			color: var(--muted);
			line-height: 1.55;
		}

		.progress-bar {
			margin: 18px 0 12px;
			height: 14px;
			border-radius: 999px;
			background: rgba(31, 111, 95, 0.12);
			overflow: hidden;
		}

		.progress-bar span {
			display: block;
			height: 100%;
			border-radius: inherit;
			background: linear-gradient(90deg, #1f6f5f 0%, #3a9d86 100%);
		}

		.progress-meta {
			display: flex;
			justify-content: space-between;
			gap: 16px;
			align-items: baseline;
			margin-bottom: 12px;
			font-family: "Avenir Next", "Segoe UI", sans-serif;
		}

		.progress-meta strong {
			font-size: 1.4rem;
		}

		.details-grid {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
			gap: 16px;
		}

		dl { margin: 0; }

		dt {
			font-size: 0.76rem;
			text-transform: uppercase;
			letter-spacing: 0.08em;
			color: var(--muted);
			margin-bottom: 8px;
		}

		dd {
			margin: 0;
			font-size: 0.98rem;
			line-height: 1.5;
			word-break: break-word;
		}

		.callout {
			padding: 18px 20px;
			border-radius: 18px;
			background: rgba(255, 255, 255, 0.68);
			border: 1px solid var(--line);
		}

		.actions {
			display: flex;
			flex-wrap: wrap;
			gap: 12px;
			margin-top: 26px;
		}

		.actions a {
			text-decoration: none;
			padding: 11px 16px;
			border-radius: 999px;
			border: 1px solid var(--line);
			color: var(--ink);
			background: rgba(255, 255, 255, 0.8);
			font-weight: 600;
		}

		.actions a.primary {
			background: #1f6f5f;
			border-color: #1f6f5f;
			color: white;
		}

		@media (max-width: 640px) {
			main {
				padding: 24px 14px 36px;
			}

			.shell {
				padding: 22px;
				border-radius: 24px;
			}

			.progress-meta {
				flex-direction: column;
				align-items: flex-start;
			}
		}
	</style>
</head>
<body>
	<main>
		<section class="shell">
			<div class="eyebrow ${badgeClass}">${escapeHtml(badgeLabel)}</div>
			<h1>${escapeHtml(headerTitle)}</h1>
			<p class="lead">${escapeHtml(subtitle)}</p>
			${progressMarkup}
			${detailsMarkup}
			${calloutMarkup}
			<div class="actions">
				${retryActionMarkup}
				<a class="primary" href="/chat">Return to chat</a>
			</div>
		</section>
	</main>
</body>
</html>`;
}