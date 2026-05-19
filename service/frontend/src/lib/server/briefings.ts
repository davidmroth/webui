import { getConfig } from '$server/env';
import { getBriefingObjectBuffer } from '$server/storage';
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
type RendererJobState = 'processing' | 'completed' | 'failed';
type RendererJobStage =
	| 'queued'
	| 'rendering_narration'
	| 'encoding_audio'
	| 'assembling_briefing'
	| 'packaging_assets'
	| 'publishing_bundle'
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

interface PublishedBriefingAssetPayload {
	buffer: Buffer;
	contentType: string;
	cacheControl: string;
	etag: string | null;
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
	readObjectBuffer?: (storageKey: string) => Promise<Buffer>;
	now?: number;
	requestHeaders?: Headers;
}

interface PublicBriefingIssue {
	message: string;
	detail: string | null;
	canRetry: boolean;
}

const DEFAULT_BRIEFING_MANIFEST_PATH = 'briefing.json';
const DEFAULT_BRIEFING_STATUS_PATH = 'status.json';
const PUBLISH_PENDING_TIMEOUT_MS = 5 * 60_000;

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

function buildStandaloneBriefingPath(identifier: string) {
	return `/briefings/${encodeURIComponent(identifier)}`;
}

function buildBriefingPlayerPath(identifier: string) {
	return `${buildStandaloneBriefingPath(identifier)}/player`;
}

function buildProxyAssetUrl(jobId: string, assetPath: string) {
	return `${buildProxyBasePath(jobId)}/assets/${encodeAssetPath(assetPath)}`;
}

function normalizeStoragePrefix(value: string) {
	return value
		.trim()
		.replace(/\\/g, '/')
		.replace(/^\/+/, '')
		.replace(/\/+$/, '');
}

function buildPublishedStorageKey(jobId: string, assetPath: string) {
	const prefix = normalizeStoragePrefix(getConfig().briefingStoragePrefix);
	return prefix ? `${prefix}/${jobId}/${assetPath}` : `${jobId}/${assetPath}`;
}

function objectErrorCode(error: unknown) {
	if (error && typeof error === 'object' && 'code' in error) {
		return String((error as { code?: unknown }).code ?? '');
	}
	return '';
}

function isMissingStorageObject(error: unknown) {
	const code = objectErrorCode(error);
	if (code === 'NoSuchKey' || code === 'NoSuchObject' || code === 'NotFound' || code === 'NoSuchBucket') {
		return true;
	}
	const message = error instanceof Error ? error.message.toLowerCase() : '';
	return message.includes('not found') || message.includes('no such key');
}

function inferAssetContentType(assetPath: string) {
	const lowered = assetPath.toLowerCase();
	if (lowered.endsWith('.json')) {
		return 'application/vnd.hermes.briefing+json; charset=utf-8';
	}
	if (lowered.endsWith('.html')) {
		return 'text/html; charset=utf-8';
	}
	if (lowered.endsWith('.css')) {
		return 'text/css; charset=utf-8';
	}
	if (lowered.endsWith('.js')) {
		return 'application/javascript; charset=utf-8';
	}
	if (lowered.endsWith('.mp3')) {
		return 'audio/mpeg';
	}
	if (lowered.endsWith('.wav')) {
		return 'audio/wav';
	}
	if (lowered.endsWith('.svg')) {
		return 'image/svg+xml';
	}
	return 'application/octet-stream';
}

function inferAssetCacheControl(assetPath: string) {
	return assetPath.toLowerCase().endsWith('.html') || assetPath.toLowerCase().endsWith('.json')
		? 'private, max-age=0, must-revalidate'
		: 'private, max-age=300';
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

function normalizeIssueMessage(rawMessage: string | null | undefined) {
	return typeof rawMessage === 'string' ? rawMessage.trim().toLowerCase() : '';
}

function buildPublicBriefingIssue(
	rawMessage: string | null | undefined,
	fallbackMessage: string,
	options: {
		detail?: string | null;
		retryable?: boolean;
		timeoutMessage?: string;
		timeoutDetail?: string | null;
	} = {}
): PublicBriefingIssue {
	const normalizedMessage = normalizeIssueMessage(rawMessage);
	const retryable = options.retryable ?? false;
	const genericDetail = options.detail ?? (retryable ? 'Retry loading the briefing in a moment.' : null);

	if (
		normalizedMessage.includes('timeout') ||
		normalizedMessage.includes('timed out') ||
		normalizedMessage.includes('read timeout')
	) {
		return {
			message: options.timeoutMessage ?? fallbackMessage,
			detail: options.timeoutDetail ?? genericDetail,
			canRetry: true
		};
	}

	if (
		normalizedMessage.includes('connection reset') ||
		normalizedMessage.includes('econnreset') ||
		normalizedMessage.includes('econnrefused') ||
		normalizedMessage.includes('network error') ||
		normalizedMessage.includes('failed to fetch')
	) {
		return {
			message: fallbackMessage,
			detail: genericDetail,
			canRetry: true
		};
	}

	if (
		normalizedMessage.includes('401') ||
		normalizedMessage.includes('403') ||
		normalizedMessage.includes('unauthorized') ||
		normalizedMessage.includes('forbidden') ||
		normalizedMessage.includes('auth')
	) {
		return {
			message: fallbackMessage,
			detail: null,
			canRetry: false
		};
	}

	return {
		message: fallbackMessage,
		detail: genericDetail,
		canRetry: retryable
	};
}
async function loadPublishedBriefingResult(jobId: string, options: BriefingClientOptions = {}) {
	const readObjectBuffer = options.readObjectBuffer ?? getBriefingObjectBuffer;
	try {
		const buffer = await readObjectBuffer(buildPublishedStorageKey(jobId, DEFAULT_BRIEFING_MANIFEST_PATH));
		const payload = parseJsonResponse(buffer.toString('utf-8'));
		return isRendererBriefingResult(payload) ? payload : null;
	} catch (error) {
		if (isMissingStorageObject(error)) {
			return null;
		}
		throw error;
	}
}

async function loadPublishedBriefingStatus(jobId: string, options: BriefingClientOptions = {}) {
	const readObjectBuffer = options.readObjectBuffer ?? getBriefingObjectBuffer;
	try {
		const buffer = await readObjectBuffer(buildPublishedStorageKey(jobId, DEFAULT_BRIEFING_STATUS_PATH));
		const payload = parseJsonResponse(buffer.toString('utf-8'));
		return isRendererJobStatus(payload) ? payload : null;
	} catch (error) {
		if (isMissingStorageObject(error)) {
			return null;
		}
		throw error;
	}
}

async function loadPublishedBriefingAsset(
	jobId: string,
	assetPath: string,
	options: BriefingClientOptions = {}
): Promise<PublishedBriefingAssetPayload | null> {
	const readObjectBuffer = options.readObjectBuffer ?? getBriefingObjectBuffer;
	const manifest = await loadPublishedBriefingResult(jobId, options);
	if (manifest === null) {
		return null;
	}

	const buffer = await readObjectBuffer(buildPublishedStorageKey(jobId, assetPath));
	const matchedAsset = manifest.assets.find((entry) => entry.path === assetPath) ?? null;
	const asset =
		assetPath === manifest.manifest_path
			? {
				content_type: 'application/vnd.hermes.briefing+json; charset=utf-8',
				cache_control: 'private, max-age=0, must-revalidate',
				sha256: null
			}
			: matchedAsset;

	const isAudioAsset = assetPath.toLowerCase().endsWith('.mp3');
	const cacheControl = isAudioAsset
		? 'private, max-age=31536000, immutable'
		: asset?.cache_control ?? inferAssetCacheControl(assetPath);
	const etag = asset?.sha256 ? `"${asset.sha256}"` : null;

	return {
		buffer,
		contentType: asset?.content_type ?? inferAssetContentType(assetPath),
		cacheControl,
		etag
	};
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

function publishValidationWarnings(status: RendererJobStatus) {
	return normalizeStringArray(status.validation?.warnings);
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
function toErrorState(jobId: string, issue: PublicBriefingIssue): BriefingPreviewError {
	return {
		state: 'error',
		status: 'error',
		jobId,
		message: issue.message,
		detail: issue.detail,
		canRetry: issue.canRetry
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
	const failedIssue =
		status.status === 'failed'
			? buildPublicBriefingIssue(status.error, 'The renderer could not finish this briefing.', {
					retryable: true,
					detail: 'Retry loading the briefing. If it still fails, regenerate the briefing from chat.',
					timeoutMessage: 'The renderer timed out while verifying the briefing assets.',
					timeoutDetail: 'Retry loading the briefing. The export may already be available.'
				})
			: null;

	const common = {
		jobId,
		briefingId: typeof status.briefing_id === 'string' ? status.briefing_id : null,
		createdAt: status.created_at,
		completedAt: typeof status.completed_at === 'string' ? status.completed_at : null,
		error: failedIssue?.message ?? null,
		detail: failedIssue?.detail ?? null,
		validation: status.validation ? normalizeValidation(status.validation) : null,
		assetCount: typeof status.asset_count === 'number' ? status.asset_count : 0,
		renderProgress: normalizeRendererProgress(status)
	};

	if (status.status === 'failed') {
		return {
			state: 'failed',
			status: 'failed',
			canRetry: failedIssue?.canRetry ?? false,
			...common
		};
	}

	return {
		state: 'processing',
		status: 'processing',
		...common
	};
}

function toPublishPendingState(status: RendererJobStatus): BriefingPreviewProcessing {
	return {
		state: 'processing',
		status: 'processing',
		jobId: status.job_id,
		briefingId: typeof status.briefing_id === 'string' ? status.briefing_id : null,
		createdAt: status.created_at,
		completedAt: typeof status.completed_at === 'string' ? status.completed_at : null,
		error: null,
		validation: status.validation ? normalizeValidation(status.validation) : null,
		assetCount: typeof status.asset_count === 'number' ? status.asset_count : 0,
		renderProgress: {
			stage: 'publishing_bundle',
			percent: 100,
			detail:
				typeof status.progress_detail === 'string' && status.progress_detail.trim().length > 0
					? status.progress_detail
					: 'Rendering finished, and the WebUI is waiting for the published bundle to arrive in object storage.',
			sentenceTotal:
				typeof status.sentence_total === 'number' && Number.isFinite(status.sentence_total)
					? Math.max(0, Math.round(status.sentence_total))
					: null,
			sentenceCompleted:
				typeof status.sentence_completed === 'number' && Number.isFinite(status.sentence_completed)
					? Math.max(0, Math.round(status.sentence_completed))
					: null
		}
	};
}

function publishTimedOut(status: RendererJobStatus, now = Date.now()) {
	if (
		publishValidationWarnings(status).some((warning) =>
			/object-storage publishing timed out|publishing timed out/i.test(warning)
		)
	) {
		return true;
	}

	const completedAtMs = Date.parse(status.completed_at ?? '');
	if (!Number.isFinite(completedAtMs)) {
		return false;
	}

	return now - completedAtMs >= PUBLISH_PENDING_TIMEOUT_MS;
}

function toPublishTimedOutState(status: RendererJobStatus): BriefingPreviewFailed {
	const warnings = publishValidationWarnings(status);
	const rendererHostedAssetsAvailable = warnings.some((warning) =>
		/renderer-hosted briefing assets remain available/i.test(warning)
	);
	const detail = rendererHostedAssetsAvailable
		? 'Rendering finished, but the published bundle never arrived in object storage. Renderer-hosted briefing assets remain available, but this WebUI only opens published bundles from object storage. Align the publisher and WebUI storage settings, then retry or regenerate the briefing.'
		: 'Rendering finished, but the published bundle never arrived in object storage. Verify the publisher is writing to the same bucket and prefix the WebUI is reading, then retry or regenerate the briefing.';

	return {
		state: 'failed',
		status: 'failed',
		jobId: status.job_id,
		briefingId: typeof status.briefing_id === 'string' ? status.briefing_id : null,
		createdAt: status.created_at,
		completedAt: typeof status.completed_at === 'string' ? status.completed_at : null,
		error: 'Publishing the briefing bundle timed out.',
		detail,
		validation: status.validation ? normalizeValidation(status.validation) : null,
		assetCount: typeof status.asset_count === 'number' ? status.asset_count : 0,
		renderProgress: {
			stage: 'publishing_bundle',
			percent: 100,
			detail:
				typeof status.progress_detail === 'string' && status.progress_detail.trim().length > 0
					? status.progress_detail
					: 'Rendering finished, and the WebUI is waiting for the published bundle to arrive in object storage.',
			sentenceTotal:
				typeof status.sentence_total === 'number' && Number.isFinite(status.sentence_total)
					? Math.max(0, Math.round(status.sentence_total))
					: null,
			sentenceCompleted:
				typeof status.sentence_completed === 'number' && Number.isFinite(status.sentence_completed)
					? Math.max(0, Math.round(status.sentence_completed))
					: null
		},
		canRetry: true
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

function toAssetLink(jobId: string, briefingId: string, asset: RendererHostedAsset): BriefingAssetLink {
	return {
		role: asset.role,
		path: asset.path,
		url:
			asset.role === 'standalone_html'
				? buildStandaloneBriefingPath(jobId)
				: buildProxyAssetUrl(jobId, asset.path),
		contentType: asset.content_type,
		sizeBytes: asset.size_bytes,
		sha256: asset.sha256,
		cacheControl: asset.cache_control
	};
}

function normalizeReadyPreview(jobId: string, result: RendererBriefingResult): BriefingPreviewReady {
	const assets = result.assets.map((asset) => toAssetLink(jobId, result.briefing_id, asset));
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

async function loadBriefingPreviewInternal(
	identifier: string,
	options: BriefingClientOptions = {},
	seenJobIds: Set<string> = new Set()
): Promise<BriefingPreview> {
	const normalizedIdentifier = identifier.trim();
	if (!normalizedIdentifier) {
		return toMissingState(identifier, 'Briefing id or job id is required.');
	}

	if (seenJobIds.has(normalizedIdentifier)) {
		return toErrorState(
			normalizedIdentifier,
			{
				message: 'Briefing preview could not resolve the latest renderer job.',
				detail: 'Open the latest briefing link from chat or regenerate the briefing.',
				canRetry: false
			}
		);
	}

	const nextSeenJobIds = new Set(seenJobIds);
	nextSeenJobIds.add(normalizedIdentifier);

	try {
		const publishedResult = await loadPublishedBriefingResult(normalizedIdentifier, options);
		if (publishedResult !== null) {
			return normalizeReadyPreview(publishedResult.job_id, publishedResult);
		}
	} catch (error) {
		console.error('Failed to load published briefing manifest from object storage', {
			jobId: normalizedIdentifier,
			error
		});
		return toErrorState(
			normalizedIdentifier,
			buildPublicBriefingIssue(
				null,
				'Briefing preview is temporarily unavailable.',
				{
					retryable: true,
					detail: 'The WebUI could not read the published briefing bundle from object storage. Retry in a moment.'
				}
			)
		);
	}

	let publishedStatus: RendererJobStatus | null;
	try {
		publishedStatus = await loadPublishedBriefingStatus(normalizedIdentifier, options);
	} catch (error) {
		console.error('Failed to load published briefing status from object storage', {
			jobId: normalizedIdentifier,
			error
		});
		return toErrorState(
			normalizedIdentifier,
			buildPublicBriefingIssue(
				null,
				'Briefing preview is temporarily unavailable.',
				{
					retryable: true,
					detail: 'The WebUI could not read the published briefing status from object storage. Retry in a moment.'
				}
			)
		);
	}

	if (publishedStatus !== null) {
		if (publishedStatus.status === 'completed') {
			return publishTimedOut(publishedStatus, options.now)
				? toPublishTimedOutState(publishedStatus)
				: toPublishPendingState(publishedStatus);
		}

		return toStatusState(publishedStatus.job_id, publishedStatus);
	}

	return toErrorState(normalizedIdentifier, {
		message: 'Briefing export is not available yet.',
		detail:
			'The WebUI is waiting for the published briefing bundle in object storage. Retry in a moment.',
		canRetry: true
	});
}

export async function loadBriefingPreview(identifier: string, options: BriefingClientOptions = {}): Promise<BriefingPreview> {
	return loadBriefingPreviewInternal(identifier, options);
}

export async function fetchBriefingAsset(jobId: string, assetPath: string, options: BriefingClientOptions = {}) {
	const normalizedJobId = jobId.trim();
	const normalizedAssetPath = normalizeAssetPath(assetPath);
	if (!normalizedJobId || !normalizedAssetPath) {
		throw new Error('A valid briefing job id and asset path are required.');
	}

	let publishedAsset;
	try {
		publishedAsset = await loadPublishedBriefingAsset(normalizedJobId, normalizedAssetPath, options);
	} catch (error) {
		console.error('Failed to load published briefing asset from object storage', {
			jobId: normalizedJobId,
			assetPath: normalizedAssetPath,
			error
		});
		throw new Error('Unable to read the published briefing asset.');
	}
	if (publishedAsset !== null) {
		const totalBytes = publishedAsset.buffer.length;
		const rangeHeader = options.requestHeaders?.get('range')?.trim() ?? null;
		const ifNoneMatch = options.requestHeaders?.get('if-none-match')?.trim() ?? null;
		const ifRange = options.requestHeaders?.get('if-range')?.trim() ?? null;
		const rangeAllowed = !ifRange || (publishedAsset.etag !== null && ifRange === publishedAsset.etag);

		const baseHeaders = {
			'content-type': publishedAsset.contentType,
			'cache-control': publishedAsset.cacheControl,
			'accept-ranges': 'bytes',
			...(publishedAsset.etag ? { etag: publishedAsset.etag } : {}),
			'x-content-type-options': 'nosniff'
		};

		if (!rangeHeader && publishedAsset.etag && ifNoneMatch && ifNoneMatch === publishedAsset.etag) {
			return new Response(null, {
				status: 304,
				headers: {
					...baseHeaders
				}
			});
		}

		if (rangeAllowed && rangeHeader && rangeHeader.toLowerCase().startsWith('bytes=')) {
			const rangeValue = rangeHeader.slice('bytes='.length).trim();
			const [rawStart, rawEnd] = rangeValue.split('-', 2);

			const startValue = rawStart?.trim() ?? '';
			const endValue = rawEnd?.trim() ?? '';

			let start = Number.NaN;
			let end = Number.NaN;

			if (startValue) {
				start = Number.parseInt(startValue, 10);
				if (endValue) {
					end = Number.parseInt(endValue, 10);
				} else {
					end = totalBytes - 1;
				}
			} else if (endValue) {
				const suffixLength = Number.parseInt(endValue, 10);
				if (Number.isFinite(suffixLength) && suffixLength > 0) {
					start = Math.max(totalBytes - suffixLength, 0);
					end = totalBytes - 1;
				}
			}

			const rangeInvalid =
				!Number.isFinite(start) ||
				!Number.isFinite(end) ||
				start < 0 ||
				end < start ||
				start >= totalBytes;

			if (rangeInvalid) {
				return new Response(null, {
					status: 416,
					headers: {
						...baseHeaders,
						'content-range': `bytes */${totalBytes}`
					}
				});
			}

			const boundedEnd = Math.min(end, totalBytes - 1);
			const chunk = publishedAsset.buffer.subarray(start, boundedEnd + 1);

			return new Response(chunk, {
				status: 206,
				headers: {
					...baseHeaders,
					'content-length': String(chunk.length),
					'content-range': `bytes ${start}-${boundedEnd}/${totalBytes}`
				}
			});
		}

		return new Response(publishedAsset.buffer, {
			status: 200,
			headers: {
				...baseHeaders,
				'content-length': String(totalBytes)
			}
		});
	}

	return new Response(JSON.stringify({ error: 'Published briefing asset not found.' }), {
		status: 404,
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'cache-control': 'private, max-age=0, must-revalidate',
			'x-content-type-options': 'nosniff'
		}
	});
}

export { buildPublicBriefingIssue, normalizeAssetPath };
