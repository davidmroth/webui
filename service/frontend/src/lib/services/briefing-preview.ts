import type { BriefingPreview, BriefingPreviewProcessing } from '$lib/types/briefing';

const DEFAULT_POLL_INTERVAL_MS = 3_000;
const MIN_POLL_INTERVAL_MS = 1_000;
const ESTIMATED_RENDER_DURATION_MS = 75_000;
const PROGRESS_FLOOR = 12;
const PROGRESS_CEILING = 94;

export interface BriefingProgressEstimate {
	percent: number;
	elapsedMs: number;
	etaMs: number | null;
	stageLabel: string;
	summary: string;
	detail: string;
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
	preview: Pick<BriefingPreviewProcessing, 'createdAt'>,
	now = Date.now()
): BriefingProgressEstimate {
	const createdAtMs = Date.parse(preview.createdAt);
	const elapsedMs = Number.isFinite(createdAtMs) ? Math.max(0, now - createdAtMs) : 0;
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
		percent,
		elapsedMs,
		etaMs,
		stageLabel,
		summary: 'Research has been completed, and the briefing is being generated.',
		detail:
			'We are rendering narration, syncing the explainer timeline, and packaging the export assets. Most briefings finish within about a minute.'
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