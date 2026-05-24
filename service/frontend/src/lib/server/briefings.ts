import { getConfig } from '$server/env';
import { getBriefingObjectBuffer } from '$server/storage';
import {
	getBriefingRecordByIdentifier,
	getLatestBriefingVersion,
	type BriefingVersion
} from '$server/briefing-records';
import type {
	CanonicalBriefingArtifact,
	BriefingAssetLink,
	BriefingCitationRef,
	BriefingMetricCard,
	BriefingPreview,
	BriefingPreviewError,
	BriefingPreviewFailed,
	BriefingPreviewMissing,
	BriefingPreviewProcessing,
	BriefingPreviewReady,
	BriefingRenderProgress,
	BriefingSection,
	BriefingSentenceSpan,
	BriefingSourceRef,
	BriefingTimelineCue,
	BriefingValidationResult
} from '$lib/types/briefing';
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

interface BriefingClientOptions {
	readObjectBuffer?: (storageKey: string) => Promise<Buffer>;
	now?: number;
	requestHeaders?: Headers;
	getBriefingRecordByIdentifierFn?: typeof getBriefingRecordByIdentifier;
	getLatestBriefingVersionFn?: typeof getLatestBriefingVersion;
}

interface PublicBriefingIssue {
	message: string;
	detail: string | null;
	canRetry: boolean;
}

const DEFAULT_BRIEFING_MANIFEST_PATH = 'briefing.json';
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

async function loadPublishedBriefingAsset(
	jobId: string,
	assetPath: string,
	options: BriefingClientOptions = {}
): Promise<PublishedBriefingAssetPayload | null> {
	const readObjectBuffer = options.readObjectBuffer ?? getBriefingObjectBuffer;
	const manifest = await loadPublishedBriefingResult(jobId, options);
	if (manifest === null) {
		try {
			const buffer = await readObjectBuffer(buildPublishedStorageKey(jobId, assetPath));
			return {
				buffer,
				contentType: inferAssetContentType(assetPath),
				cacheControl: inferAssetCacheControl(assetPath),
				etag: null
			};
		} catch (error) {
			if (isMissingStorageObject(error)) {
				return null;
			}
			throw error;
		}
	}

	const buffer = await readObjectBuffer(buildPublishedStorageKey(jobId, assetPath));
	const matchedAsset = manifest.assets.find((entry) => entry.path === assetPath) ?? null;
	const asset =
		assetPath === DEFAULT_BRIEFING_MANIFEST_PATH
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

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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

function canonicalAssetFromPublishedAsset(asset: RendererHostedAsset): BriefingAssetLink {
	return {
		role: asset.role,
		path: asset.path,
		url: '',
		contentType: asset.content_type,
		sizeBytes: asset.size_bytes,
		sha256: asset.sha256,
		cacheControl: asset.cache_control
	};
}

export function canonicalArtifactFromPublishedResult(result: RendererBriefingResult): CanonicalBriefingArtifact {
	const assets = result.assets.map((asset) => canonicalAssetFromPublishedAsset(asset));
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
		schemaVersion: 'briefing-document/v1',
		jobId: result.job_id,
		briefingId: result.briefing_id,
		title: result.title,
		topic: result.topic,
		summary: result.summary ?? null,
		generatedAt: result.generated_at,
		locale: result.locale,
		generatedBy: result.generated_by,
		validation: normalizeValidation(result.validation),
		assets,
		audioAsset: assetByPath.get(result.audio_path) ?? assets.find((asset) => asset.role === 'audio') ?? null,
		sections,
		sources,
		timelineCues
	};
}

export async function loadPublishedCanonicalArtifact(jobId: string, options: BriefingClientOptions = {}) {
	const result = await loadPublishedBriefingResult(jobId, options);
	return result ? canonicalArtifactFromPublishedResult(result) : null;
}

function normalizeReadyPreview(jobId: string, result: RendererBriefingResult): BriefingPreviewReady {
	const artifact = canonicalArtifactFromPublishedResult(result);
	const assets = result.assets.map((asset) => toAssetLink(jobId, result.briefing_id, asset));
	const assetByPath = new Map<string, BriefingAssetLink>(assets.map((asset) => [asset.path, asset]));

	return {
		state: 'ready',
		status: 'completed',
		jobId,
		briefingId: artifact.briefingId ?? jobId,
		title: artifact.title,
		topic: artifact.topic,
		summary: artifact.summary,
		generatedAt: artifact.generatedAt,
		locale: artifact.locale,
		generatedBy: artifact.generatedBy,
		validation: artifact.validation,
		audioAsset: assetByPath.get(result.audio_path) ?? assets.find((asset) => asset.role === 'audio') ?? null,
		exportHtmlAsset:
			assetByPath.get(result.standalone_html_path) ??
			assets.find((asset) => asset.role === 'standalone_html') ??
			null,
		assets,
		sections: artifact.sections,
		sources: artifact.sources,
		timelineCues: artifact.timelineCues
	};
}

function normalizeCanonicalAsset(jobId: string, asset: BriefingAssetLink): BriefingAssetLink {
	return {
		...asset,
		url:
			asset.role === 'standalone_html'
				? buildStandaloneBriefingPath(jobId)
				: asset.role === 'audio'
					? buildProxyAssetUrl(jobId, asset.path)
					: asset.url || buildProxyAssetUrl(jobId, asset.path)
	};
}

function normalizeReadyPreviewFromCanonical(jobId: string, artifact: BriefingVersion['artifact']): BriefingPreviewReady {
	const assets = artifact.assets.map((asset) => normalizeCanonicalAsset(jobId, asset));
	const audioAsset = artifact.audioAsset ? normalizeCanonicalAsset(jobId, artifact.audioAsset) : assets.find((asset) => asset.role === 'audio') ?? null;
	const exportHtmlAsset = {
		role: 'standalone_html' as const,
		path: 'standalone',
		url: buildStandaloneBriefingPath(jobId),
		contentType: 'text/html; charset=utf-8',
		sizeBytes: 0,
		sha256: '',
		cacheControl: 'private, max-age=0, must-revalidate'
	};

	return {
		state: 'ready',
		status: 'completed',
		jobId,
		briefingId: artifact.briefingId ?? jobId,
		title: artifact.title,
		topic: artifact.topic,
		summary: artifact.summary,
		generatedAt: artifact.generatedAt,
		locale: artifact.locale,
		generatedBy: artifact.generatedBy,
		validation: artifact.validation,
		audioAsset,
		exportHtmlAsset,
		assets,
		sections: artifact.sections,
		sources: artifact.sources,
		timelineCues: artifact.timelineCues
	};
}

function normalizeCanonicalRenderProgress(
	record: Awaited<ReturnType<typeof getBriefingRecordByIdentifier>>
): BriefingRenderProgress | null {
	const normalizedStage = typeof record?.stage === 'string' ? record.stage.trim() : '';
	if (!normalizedStage) {
		return null;
	}

	const percentByStage: Record<RendererJobStage, number> = {
		queued: 1,
		rendering_narration: 32,
		encoding_audio: 58,
		assembling_briefing: 76,
		packaging_assets: 88,
		publishing_bundle: 95,
		completed: 100,
		failed: 100
	};
	const detailByStage: Partial<Record<RendererJobStage, string>> = {
		queued: 'Waiting for a renderer slot to become available.',
		rendering_narration: 'The renderer is narrating the saved canonical briefing.',
		encoding_audio: 'The renderer is encoding the refreshed audio track.',
		assembling_briefing: 'The renderer is validating and assembling the rerendered briefing outputs.',
		packaging_assets: 'The renderer is finalizing the rerendered briefing assets.',
		publishing_bundle: 'The renderer is publishing the rerendered audio asset.',
		completed: 'The rerendered briefing is ready.',
		failed: 'The renderer reported a failure while rebuilding the briefing audio.'
	};
	if (!(normalizedStage in percentByStage)) {
		return null;
	}

	const explicitPercent =
		typeof record?.progressPercent === 'number' && Number.isFinite(record.progressPercent)
			? Math.min(100, Math.max(0, Math.round(record.progressPercent)))
			: null;
	const explicitDetail =
		typeof record?.progressDetail === 'string' && record.progressDetail.trim().length > 0
			? record.progressDetail
			: null;
	const explicitSentenceTotal =
		typeof record?.sentenceTotal === 'number' && Number.isFinite(record.sentenceTotal)
			? Math.max(0, Math.round(record.sentenceTotal))
			: null;
	const explicitSentenceCompleted =
		typeof record?.sentenceCompleted === 'number' && Number.isFinite(record.sentenceCompleted)
			? Math.max(0, Math.round(record.sentenceCompleted))
			: null;

	return {
		stage: normalizedStage as RendererJobStage,
		percent: explicitPercent ?? percentByStage[normalizedStage as RendererJobStage],
		detail: explicitDetail ?? detailByStage[normalizedStage as RendererJobStage] ?? null,
		sentenceTotal: explicitSentenceTotal,
		sentenceCompleted: explicitSentenceCompleted
	};
}

function publishTimedOutFromRecord(
	record: Awaited<ReturnType<typeof getBriefingRecordByIdentifier>>,
	now = Date.now()
) {
	const publishStartedAtMs = Date.parse(record?.updatedAt ?? record?.completedAt ?? '');
	if (!Number.isFinite(publishStartedAtMs)) {
		return false;
	}

	return now - publishStartedAtMs >= PUBLISH_PENDING_TIMEOUT_MS;
}

function toCanonicalPublishTimedOutState(
	record: Awaited<ReturnType<typeof getBriefingRecordByIdentifier>>,
	artifact: BriefingVersion['artifact'] | null
): BriefingPreviewFailed {
	return {
		state: 'failed',
		status: 'failed',
		jobId: record?.jobId ?? '',
		briefingId: record?.briefingId ?? null,
		createdAt: record?.startedAt ?? record?.createdAt ?? new Date(0).toISOString(),
		completedAt: record?.updatedAt ?? null,
		error: 'Publishing the briefing bundle timed out.',
		detail:
			'Rendering finished, but the published bundle never arrived in object storage. Verify the publisher is writing to the same bucket and prefix the WebUI is reading, then retry or regenerate the briefing.',
		validation: null,
		assetCount: artifact?.assets.length ?? 0,
		renderProgress: normalizeCanonicalRenderProgress(record),
		canRetry: true
	};
}

function normalizeCanonicalProcessingPreview(
	record: Awaited<ReturnType<typeof getBriefingRecordByIdentifier>>,
	artifact: BriefingVersion['artifact'] | null
): BriefingPreviewProcessing | BriefingPreviewFailed {
	const renderProgress = normalizeCanonicalRenderProgress(record);
	const assetCount = artifact?.assets.length ?? 0;
	if (record?.state === 'failed') {
		return {
			state: 'failed',
			status: 'failed',
			jobId: record.jobId,
			briefingId: record.briefingId,
			createdAt: record.startedAt ?? record.createdAt,
			completedAt: record.failedAt ?? record.completedAt,
			error: record.errorMessage,
			detail: record.errorMessage,
			validation: null,
			assetCount,
			renderProgress,
			canRetry: true
		};
	}

	return {
		state: 'processing',
		status: 'processing',
		jobId: record?.jobId ?? '',
		briefingId: record?.briefingId ?? null,
		createdAt: record?.startedAt ?? record?.createdAt ?? new Date(0).toISOString(),
		completedAt: null,
		error: null,
		validation: null,
		assetCount,
		renderProgress
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
	const getBriefingRecordByIdentifierFn = options.getBriefingRecordByIdentifierFn ?? getBriefingRecordByIdentifier;
	const getLatestBriefingVersionFn = options.getLatestBriefingVersionFn ?? getLatestBriefingVersion;
	const canonicalRecord = await getBriefingRecordByIdentifierFn(normalizedIdentifier).catch(() => null);
	const resolvedJobId = canonicalRecord?.jobId ?? normalizedIdentifier;
	if (canonicalRecord) {
		const latestVersion = await getLatestBriefingVersionFn(canonicalRecord.jobId).catch(() => null);
		if (canonicalRecord.state === 'ready' && latestVersion) {
			return normalizeReadyPreviewFromCanonical(canonicalRecord.jobId, latestVersion.artifact);
		}
		if (canonicalRecord.state !== 'ready') {
			if (canonicalRecord.stage === 'publishing_bundle' && publishTimedOutFromRecord(canonicalRecord, options.now)) {
				return toCanonicalPublishTimedOutState(canonicalRecord, latestVersion?.artifact ?? null);
			}

			return normalizeCanonicalProcessingPreview(canonicalRecord, latestVersion?.artifact ?? null);
		}
	}

	try {
		const publishedResult = await loadPublishedBriefingResult(resolvedJobId, options);
		if (publishedResult !== null) {
			return normalizeReadyPreview(publishedResult.job_id, publishedResult);
		}
	} catch (error) {
		console.error('Failed to load published briefing manifest from object storage', {
			jobId: resolvedJobId,
			error
		});
		return toErrorState(
			resolvedJobId,
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

	return toErrorState(resolvedJobId, {
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

						return new Response(new Uint8Array(chunk), {
				status: 206,
				headers: {
					...baseHeaders,
					'content-length': String(chunk.length),
					'content-range': `bytes ${start}-${boundedEnd}/${totalBytes}`
				}
			});
		}

				return new Response(new Uint8Array(publishedAsset.buffer), {
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
