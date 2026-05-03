import { getConfig } from '$server/env';
import type {
	BriefingAssetLink,
	BriefingCitationRef,
	BriefingMetricCard,
	BriefingPreview,
	BriefingPreviewError,
	BriefingPreviewFailed,
	BriefingPreviewMissing,
	BriefingPreviewProcessing,
	BriefingPreviewReady,
	BriefingSection,
	BriefingSentenceSpan,
	BriefingSourceRef,
	BriefingTimelineCue,
	BriefingValidationResult
} from '$lib/types/briefing';

type FetchImpl = typeof fetch;
type RendererJobState = 'processing' | 'completed' | 'failed';
type RendererJobStage =
	| 'queued'
	| 'rendering_narration'
	| 'encoding_audio'
	| 'assembling_briefing'
	| 'packaging_assets'
	| 'completed'
	| 'failed';
type RendererCueKind = 'section' | 'sentence' | 'metric' | 'illustration' | 'citation';
type RendererIllustrationKind = 'illustration' | 'map' | 'chart';
type RendererAssetRole = 'audio' | 'standalone_html' | 'player_css' | 'player_js' | 'illustration';

interface RendererValidationResult {
	valid?: unknown;
	warnings?: unknown;
	errors?: unknown;
}

interface RendererSourceRef {
	id: string;
	title: string;
	publisher: string;
	url: string;
	accessed_at?: string | null;
	excerpt?: string | null;
}

interface RendererCitationRef {
	id: string;
	label: string;
	source_id: string;
	note?: string | null;
}

interface RendererMetricCard {
	id: string;
	label: string;
	value: string;
	trend?: string | null;
}

interface RendererIllustrationBlock {
	id: string;
	title: string;
	caption: string;
	kind: RendererIllustrationKind;
}

interface RendererSentenceSpan {
	id: string;
	text: string;
	start: number;
	end: number;
}

interface RendererSectionOutput {
	id: string;
	title: string;
	narration: string;
	body: string[];
	metrics: RendererMetricCard[];
	illustrations: RendererIllustrationBlock[];
	citations: RendererCitationRef[];
	sentences: RendererSentenceSpan[];
	start: number;
	end: number;
}

interface RendererTimelineCue {
	cue_id: string;
	element_id: string;
	kind: RendererCueKind;
	start: number;
	end: number;
	label: string;
}

interface RendererHostedAsset {
	role: RendererAssetRole;
	path: string;
	content_type: string;
	size_bytes: number;
	sha256: string;
	cache_control: string;
}

interface RendererBriefingResult {
	job_id: string;
	briefing_id: string;
	title: string;
	topic: string;
	summary?: string | null;
	generated_at: string;
	locale: string;
	generated_by: string;
	standalone_html_path: string;
	audio_path: string;
	sections: RendererSectionOutput[];
	sources: RendererSourceRef[];
	timeline_cues: RendererTimelineCue[];
	assets: RendererHostedAsset[];
	validation: RendererValidationResult;
}

interface RendererJobStatus {
	job_id: string;
	briefing_id?: string | null;
	status: RendererJobState;
	stage?: RendererJobStage | null;
	progress_percent?: number | null;
	progress_detail?: string | null;
	sentence_total?: number | null;
	sentence_completed?: number | null;
	created_at: string;
	completed_at?: string | null;
	error?: string | null;
	validation?: RendererValidationResult | null;
	asset_count?: number;
}

interface BriefingClientOptions {
	baseUrl?: string;
	serviceToken?: string;
	timeoutMs?: number;
	fetchImpl?: FetchImpl;
}

interface BriefingClientConfig {
	baseUrl: string;
	serviceToken: string;
	timeoutMs: number;
	fetchImpl: FetchImpl;
}

function normalizeBaseUrl(baseUrl: string) {
	return baseUrl.replace(/\/+$/, '');
}

function normalizeAssetPath(assetPath: string) {
	const segments = assetPath
		.split('/')
		.map((segment) => segment.trim())
		.filter(Boolean);

	if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) {
		return null;
	}

	return segments.join('/');
}

function encodeAssetPath(assetPath: string) {
	return assetPath
		.split('/')
		.map((segment) => encodeURIComponent(segment))
		.join('/');
}

function buildProxyBasePath(jobId: string) {
	return `/api/briefings/${encodeURIComponent(jobId)}`;
}

function buildProxyAssetUrl(jobId: string, assetPath: string) {
	return `${buildProxyBasePath(jobId)}/assets/${encodeAssetPath(assetPath)}`;
}

function buildRendererHeaders(serviceToken: string, accept: string) {
	const headers = new Headers({ Accept: accept });
	if (serviceToken.trim()) {
		headers.set('Authorization', `Bearer ${serviceToken.trim()}`);
	}
	return headers;
}

function parseJsonResponse(text: string): unknown {
	if (!text) {
		return null;
	}

	try {
		return JSON.parse(text) as unknown;
	} catch {
		return { error: text };
	}
}

function normalizeStringArray(value: unknown) {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function normalizeValidation(value: RendererValidationResult | null | undefined): BriefingValidationResult {
	return {
		valid: value?.valid !== false,
		warnings: normalizeStringArray(value?.warnings),
		errors: normalizeStringArray(value?.errors)
	};
}

function normalizeRendererProgress(status: RendererJobStatus) {
	const stage = typeof status.stage === 'string' ? status.stage : null;
	const percent =
		typeof status.progress_percent === 'number' && Number.isFinite(status.progress_percent)
			? Math.min(100, Math.max(0, Math.round(status.progress_percent)))
			: null;
	const detail =
		typeof status.progress_detail === 'string' && status.progress_detail.trim().length > 0
			? status.progress_detail
			: null;
	const sentenceTotal =
		typeof status.sentence_total === 'number' && Number.isFinite(status.sentence_total)
			? Math.max(0, Math.round(status.sentence_total))
			: null;
	const sentenceCompleted =
		typeof status.sentence_completed === 'number' && Number.isFinite(status.sentence_completed)
			? Math.max(0, Math.round(status.sentence_completed))
			: null;

	if (stage === null) {
		return null;
	}

	return {
		stage,
		percent,
		detail,
		sentenceTotal,
		sentenceCompleted
	};
}

function buildClientConfig(options: BriefingClientOptions = {}): BriefingClientConfig {
	const config = getConfig();
	return {
		baseUrl: normalizeBaseUrl(options.baseUrl ?? config.briefingRendererBaseUrl),
		serviceToken: options.serviceToken ?? config.briefingRendererServiceToken,
		timeoutMs: options.timeoutMs ?? config.briefingRendererTimeoutMs,
		fetchImpl: options.fetchImpl ?? fetch
	};
}

function toErrorState(jobId: string, message: string, detail: string | null = null): BriefingPreviewError {
	return {
		state: 'error',
		status: 'error',
		jobId,
		message,
		detail
	};
}

function toMissingState(jobId: string, message: string): BriefingPreviewMissing {
	return {
		state: 'missing',
		status: 'missing',
		jobId,
		message
	};
}

function toStatusState(jobId: string, status: RendererJobStatus): BriefingPreviewProcessing | BriefingPreviewFailed {
	const common = {
		jobId,
		briefingId: typeof status.briefing_id === 'string' ? status.briefing_id : null,
		createdAt: status.created_at,
		completedAt: typeof status.completed_at === 'string' ? status.completed_at : null,
		error: typeof status.error === 'string' ? status.error : null,
		validation: status.validation ? normalizeValidation(status.validation) : null,
		assetCount: typeof status.asset_count === 'number' ? status.asset_count : 0,
		renderProgress: normalizeRendererProgress(status)
	};

	if (status.status === 'failed') {
		return {
			state: 'failed',
			status: 'failed',
			...common
		};
	}

	return {
		state: 'processing',
		status: 'processing',
		...common
	};
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isRendererJobStatus(value: unknown): value is RendererJobStatus {
	return isObjectRecord(value) && typeof value.job_id === 'string' && typeof value.status === 'string';
}

function isRendererBriefingResult(value: unknown): value is RendererBriefingResult {
	return (
		isObjectRecord(value) &&
		typeof value.job_id === 'string' &&
		typeof value.briefing_id === 'string' &&
		typeof value.title === 'string' &&
		Array.isArray(value.sections) &&
		Array.isArray(value.assets) &&
		Array.isArray(value.timeline_cues) &&
		Array.isArray(value.sources)
	);
}

function errorDetailFromPayload(payload: unknown) {
	if (isObjectRecord(payload) && typeof payload.error === 'string') {
		return payload.error;
	}

	return null;
}

async function requestRendererJson(path: string, options: BriefingClientOptions = {}) {
	const config = buildClientConfig(options);
	let response: Response;

	try {
		response = await config.fetchImpl(`${config.baseUrl}${path}`, {
			method: 'GET',
			headers: buildRendererHeaders(config.serviceToken, 'application/json'),
			signal: AbortSignal.timeout(config.timeoutMs)
		});
	} catch (error) {
		throw new Error(error instanceof Error ? error.message : 'Unknown network error.');
	}

	const text = await response.text();
	return {
		response,
		payload: parseJsonResponse(text)
	};
}

function toAssetLink(jobId: string, asset: RendererHostedAsset): BriefingAssetLink {
	return {
		role: asset.role,
		path: asset.path,
		url: buildProxyAssetUrl(jobId, asset.path),
		contentType: asset.content_type,
		sizeBytes: asset.size_bytes,
		sha256: asset.sha256,
		cacheControl: asset.cache_control
	};
}

function normalizeReadyPreview(jobId: string, result: RendererBriefingResult): BriefingPreviewReady {
	const timelineCues: BriefingTimelineCue[] = result.timeline_cues.map((cue) => ({
		cueId: cue.cue_id,
		elementId: cue.element_id,
		kind: cue.kind,
		start: cue.start,
		end: cue.end,
		label: cue.label
	}));
	const cueByElementId = new Map<string, BriefingTimelineCue>(timelineCues.map((cue) => [cue.elementId, cue]));
	const sources: BriefingSourceRef[] = result.sources.map((source) => ({
		id: source.id,
		title: source.title,
		publisher: source.publisher,
		url: source.url,
		accessedAt: source.accessed_at ?? null,
		excerpt: source.excerpt ?? null
	}));
	const sourceById = new Map<string, BriefingSourceRef>(sources.map((source) => [source.id, source]));
	const assets = result.assets.map((asset) => toAssetLink(jobId, asset));
	const assetByPath = new Map<string, BriefingAssetLink>(assets.map((asset) => [asset.path, asset]));

	const sections: BriefingSection[] = result.sections.map((section) => {
		const sentences: BriefingSentenceSpan[] = section.sentences.map((sentence) => ({
			id: sentence.id,
			text: sentence.text,
			start: sentence.start,
			end: sentence.end,
			cue: cueByElementId.get(sentence.id) ?? null
		}));
		const metrics: BriefingMetricCard[] = section.metrics.map((metric) => ({
			id: metric.id,
			label: metric.label,
			value: metric.value,
			trend: metric.trend ?? null,
			cue: cueByElementId.get(metric.id) ?? null
		}));
		const citations: BriefingCitationRef[] = section.citations.map((citation) => ({
			id: citation.id,
			label: citation.label,
			sourceId: citation.source_id,
			note: citation.note ?? null,
			source: sourceById.get(citation.source_id) ?? null,
			cue: cueByElementId.get(citation.id) ?? null
		}));
		const illustrations = section.illustrations.map((illustration) => ({
			id: illustration.id,
			title: illustration.title,
			caption: illustration.caption,
			kind: illustration.kind,
			asset: assetByPath.get(`illustrations/${illustration.id}.svg`) ?? null,
			cue: cueByElementId.get(illustration.id) ?? null
		}));

		return {
			id: section.id,
			title: section.title,
			narration: section.narration,
			body: section.body,
			metrics,
			illustrations,
			citations,
			sentences,
			start: section.start,
			end: section.end,
			cue: cueByElementId.get(section.id) ?? null
		};
	});

	return {
		state: 'ready',
		status: 'completed',
		jobId,
		briefingId: result.briefing_id,
		title: result.title,
		topic: result.topic,
		summary: result.summary ?? null,
		generatedAt: result.generated_at,
		locale: result.locale,
		generatedBy: result.generated_by,
		validation: normalizeValidation(result.validation),
		audioAsset: assetByPath.get(result.audio_path) ?? assets.find((asset) => asset.role === 'audio') ?? null,
		exportHtmlAsset:
			assetByPath.get(result.standalone_html_path) ??
			assets.find((asset) => asset.role === 'standalone_html') ??
			null,
		assets,
		sections,
		sources,
		timelineCues
	};
}

export async function loadBriefingPreview(jobId: string, options: BriefingClientOptions = {}): Promise<BriefingPreview> {
	const normalizedJobId = jobId.trim();
	if (!normalizedJobId) {
		return toMissingState(jobId, 'Briefing job id is required.');
	}

	let statusResult;
	try {
		statusResult = await requestRendererJson(`/v1/briefings/${encodeURIComponent(normalizedJobId)}`, options);
	} catch (error) {
		return toErrorState(
			normalizedJobId,
			'Briefing preview is temporarily unavailable.',
			error instanceof Error ? error.message : 'Unknown network error.'
		);
	}

	if (statusResult.response.status === 404) {
		return toMissingState(normalizedJobId, 'No briefing job was found for this id.');
	}

	if (statusResult.response.status === 401 || statusResult.response.status === 403) {
		return toErrorState(
			normalizedJobId,
			'WebUI could not authenticate with the briefing service.',
			errorDetailFromPayload(statusResult.payload)
		);
	}

	if (!statusResult.response.ok || !isRendererJobStatus(statusResult.payload)) {
		return toErrorState(
			normalizedJobId,
			'WebUI could not load briefing status.',
			errorDetailFromPayload(statusResult.payload)
		);
	}

	if (statusResult.payload.status !== 'completed') {
		return toStatusState(normalizedJobId, statusResult.payload);
	}

	let previewResult;
	try {
		previewResult = await requestRendererJson(
			`/v1/briefings/${encodeURIComponent(normalizedJobId)}/result`,
			options
		);
	} catch (error) {
		return toErrorState(
			normalizedJobId,
			'Briefing result is temporarily unavailable.',
			error instanceof Error ? error.message : 'Unknown network error.'
		);
	}

	if (previewResult.response.status === 404) {
		return {
			state: 'processing',
			status: 'processing',
			jobId: normalizedJobId,
			briefingId: typeof statusResult.payload.briefing_id === 'string' ? statusResult.payload.briefing_id : null,
			createdAt: statusResult.payload.created_at,
			completedAt: typeof statusResult.payload.completed_at === 'string' ? statusResult.payload.completed_at : null,
			error: null,
			validation: statusResult.payload.validation ? normalizeValidation(statusResult.payload.validation) : null,
			assetCount: typeof statusResult.payload.asset_count === 'number' ? statusResult.payload.asset_count : 0
		};
	}

	if (previewResult.response.status === 401 || previewResult.response.status === 403) {
		return toErrorState(
			normalizedJobId,
			'WebUI could not authenticate with the briefing service.',
			errorDetailFromPayload(previewResult.payload)
		);
	}

	if (!previewResult.response.ok || !isRendererBriefingResult(previewResult.payload)) {
		return toErrorState(
			normalizedJobId,
			'WebUI could not load the completed briefing result.',
			errorDetailFromPayload(previewResult.payload)
		);
	}

	return normalizeReadyPreview(normalizedJobId, previewResult.payload);
}

export async function fetchBriefingAsset(jobId: string, assetPath: string, options: BriefingClientOptions = {}) {
	const normalizedJobId = jobId.trim();
	const normalizedAssetPath = normalizeAssetPath(assetPath);
	if (!normalizedJobId || !normalizedAssetPath) {
		throw new Error('A valid briefing job id and asset path are required.');
	}

	const config = buildClientConfig(options);
	return config.fetchImpl(
		`${config.baseUrl}/v1/briefings/${encodeURIComponent(normalizedJobId)}/assets/${encodeAssetPath(normalizedAssetPath)}`,
		{
			method: 'GET',
			headers: buildRendererHeaders(config.serviceToken, '*/*'),
			signal: AbortSignal.timeout(config.timeoutMs)
		}
	);
}

export { normalizeAssetPath };
