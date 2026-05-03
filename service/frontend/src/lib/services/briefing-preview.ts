import type { BriefingPreview, BriefingPreviewProcessing, BriefingRenderStage } from '$lib/types/briefing';

const DEFAULT_POLL_INTERVAL_MS = 3_000;
const MIN_POLL_INTERVAL_MS = 1_000;
const ESTIMATED_RENDER_DURATION_MS = 75_000;
const PROGRESS_FLOOR = 12;
const PROGRESS_CEILING = 94;

export interface BriefingProgressEstimate {
	source: 'estimated' | 'renderer';
	percent: number;
	elapsedMs: number;
	etaMs: number | null;
	stageLabel: string;
	summary: string;
	detail: string;
	trailingLabel: string | null;
}

interface FetchBriefingPreviewOptions {
	basePath?: string;
	fetchImpl?: typeof fetch;
}

interface BriefingPreviewPollingOptions extends FetchBriefingPreviewOptions {
	jobId: string;
	intervalMs?: number;
	onUpdate: (preview: BriefingPreview) => void;
	onError?: (message: string | null) => void;
}

const BRIEFING_PREVIEW_STATES = new Set(['ready', 'processing', 'failed', 'missing', 'error']);
const RENDERER_STAGE_COPY: Record<
	BriefingRenderStage,
	{
		defaultPercent: number;
		stageLabel: string;
		summary: string;
		detail: string;
	}
> = {
	queued: {
		defaultPercent: 1,
		stageLabel: 'Queued for renderer availability',
		summary: 'The briefing has been accepted and is waiting for the renderer.',
		detail: 'Another briefing is already using the local renderer. This job will start automatically when a slot is free.'
	},
	rendering_narration: {
		defaultPercent: 36,
		stageLabel: 'Rendering narration and timing cues',
		summary: 'The renderer is actively generating spoken narration for this briefing.',
		detail: 'Long narrated briefings can take several minutes on the local TTS sidecar, especially when multiple jobs are queued.'
	},
	encoding_audio: {
		defaultPercent: 84,
		stageLabel: 'Encoding the final audio track',
		summary: 'Narration is complete and the renderer is encoding the final audio track.',
		detail: 'The synthesized narration is being converted into the export audio asset.'
	},
	assembling_briefing: {
		defaultPercent: 92,
		stageLabel: 'Building timeline and briefing bundle',
		summary: 'The renderer is assembling timeline cues, validation, and HTML output.',
		detail: 'The narrated briefing bundle is being assembled from the completed audio and source data.'
	},
	packaging_assets: {
		defaultPercent: 97,
		stageLabel: 'Writing packaged assets',
		summary: 'The renderer is writing the final briefing assets and manifest.',
		detail: 'The export bundle is almost ready.'
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
		summary: 'The renderer reported a failure for this briefing.',
		detail: 'Check the reported error for the failed stage.'
	}
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isBriefingPreview(value: unknown): value is BriefingPreview {
	return (
		isObjectRecord(value) &&
		typeof value.jobId === 'string' &&
		typeof value.state === 'string' &&
		BRIEFING_PREVIEW_STATES.has(value.state)
	);
}

function normalizeBasePath(basePath = '') {
	return basePath.replace(/\/+$/, '');
}

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

export function buildBriefingPreviewApiPath(jobId: string, basePath = '') {
	return `${normalizeBasePath(basePath)}/api/briefings/${encodeURIComponent(jobId.trim())}`;
}

export async function fetchBriefingPreview(
	jobId: string,
	options: FetchBriefingPreviewOptions = {}
): Promise<BriefingPreview> {
	const normalizedJobId = jobId.trim();
	if (!normalizedJobId) {
		throw new Error('Briefing job id is required.');
	}

	const response = await (options.fetchImpl ?? fetch)(
		buildBriefingPreviewApiPath(normalizedJobId, options.basePath),
		{
			method: 'GET',
			headers: { Accept: 'application/json' }
		}
	);

	const payload = await response.json().catch(() => null);
	if (isBriefingPreview(payload)) {
		return payload;
	}

	const fallbackMessage = response.ok
		? 'Unable to load the current briefing status.'
		: `Unable to load briefing status (${response.status}).`;
	const errorMessage =
		isObjectRecord(payload) && typeof payload.error === 'string' && payload.error.trim().length > 0
			? payload.error
			: fallbackMessage;
	throw new Error(errorMessage);
}

export function estimateBriefingRenderProgress(
	preview: Pick<BriefingPreviewProcessing, 'createdAt' | 'renderProgress'>,
	now = Date.now()
): BriefingProgressEstimate {
	const createdAtMs = Date.parse(preview.createdAt);
	const elapsedMs = Number.isFinite(createdAtMs) ? Math.max(0, now - createdAtMs) : 0;

	if (preview.renderProgress) {
		const stageCopy = RENDERER_STAGE_COPY[preview.renderProgress.stage];
		const percent = Math.max(
			0,
			Math.min(100, preview.renderProgress.percent ?? stageCopy.defaultPercent)
		);
		const sentenceTotal = preview.renderProgress.sentenceTotal;
		const sentenceCompleted = preview.renderProgress.sentenceCompleted;
		const trailingLabel =
			typeof sentenceTotal === 'number' && sentenceTotal > 0
				? `${Math.min(sentenceTotal, Math.max(0, sentenceCompleted ?? 0))} of ${sentenceTotal} narration segments completed`
				: preview.renderProgress.stage === 'queued'
					? 'Starts automatically when a render slot is free'
					: 'Live renderer status';

		return {
			source: 'renderer',
			percent,
			elapsedMs,
			etaMs: null,
			stageLabel: stageCopy.stageLabel,
			summary: stageCopy.summary,
			detail:
				typeof preview.renderProgress.detail === 'string' && preview.renderProgress.detail.trim().length > 0
					? preview.renderProgress.detail
					: stageCopy.detail,
			trailingLabel
		};
	}

	const percent = Math.max(PROGRESS_FLOOR, Math.min(PROGRESS_CEILING, interpolateProgress(elapsedMs)));
	const etaMs = elapsedMs >= ESTIMATED_RENDER_DURATION_MS ? null : ESTIMATED_RENDER_DURATION_MS - elapsedMs;

	let stageLabel = 'Preparing the briefing render';
	if (percent >= 82) {
		stageLabel = 'Running final validation and packaging';
	} else if (percent >= 58) {
		stageLabel = 'Syncing narration, cue timing, and HTML';
	} else if (percent >= 34) {
		stageLabel = 'Generating narration and timing cues';
	}

	return {
		source: 'estimated',
		percent,
		elapsedMs,
		etaMs,
		stageLabel,
		summary: 'Research has been completed, and the briefing is being generated.',
		detail:
			'We are rendering narration, syncing the explainer timeline, and packaging the export assets. Most briefings finish within about a minute.',
		trailingLabel: null
	};
}

export function startBriefingPreviewPolling(options: BriefingPreviewPollingOptions) {
	if (typeof window === 'undefined') {
		return () => {};
	}

	let cancelled = false;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let inFlight = false;
	const intervalMs = Math.max(MIN_POLL_INTERVAL_MS, options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS);

	const clearTimer = () => {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
	};

	const schedule = () => {
		if (cancelled) {
			return;
		}
		clearTimer();
		timer = setTimeout(runPoll, intervalMs);
	};

	const runPoll = async () => {
		if (cancelled || inFlight) {
			return;
		}
		inFlight = true;

		try {
			const preview = await fetchBriefingPreview(options.jobId, options);
			options.onUpdate(preview);
			options.onError?.(null);
			if (preview.state === 'processing') {
				schedule();
			}
		} catch (error) {
			options.onError?.(
				error instanceof Error ? error.message : 'Unable to refresh the briefing status right now.'
			);
			schedule();
		} finally {
			inFlight = false;
		}
	};

	schedule();

	return () => {
		cancelled = true;
		clearTimer();
	};
}