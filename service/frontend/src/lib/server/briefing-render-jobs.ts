import { randomUUID } from 'node:crypto';
import { execute, query } from './db';
import { buildPublishedStorageKey } from './briefing-catalog';
import {
	getBriefingRecord,
	getBriefingVersion,
	getLatestBriefingVersion,
	updateBriefingVersionArtifact,
	type BriefingRecord,
	type BriefingVersion,
	type BriefingAssetInput
} from './briefing-records';
import type {
	CanonicalBriefingArtifact,
	BriefingGenerationProvenance
} from './briefing-artifact';
import type { BriefingAssetLink, BriefingRenderStage, BriefingValidationResult } from '$lib/types/briefing';

export type BriefingRenderJobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
const DEFAULT_AUDIO_ASSET_PATH = 'audio.mp3';
const DEFAULT_AUDIO_CONTENT_TYPE = 'audio/mpeg';
const DEFAULT_AUDIO_CACHE_CONTROL = 'private, max-age=300';

export interface BriefingRenderJob {
	id: string;
	jobId: string;
	briefingVersionNumber: number;
	requestedByUserId: string;
	status: BriefingRenderJobStatus;
	errorMessage: string | null;
	createdAt: string;
	claimedAt: string | null;
	completedAt: string | null;
}

export interface BriefingRenderProgressInput {
	percent?: number | null;
	detail?: string | null;
	sentenceTotal?: number | null;
	sentenceCompleted?: number | null;
}

export interface ClaimedBriefingRenderJob {
	renderJobId: string;
	jobId: string;
	briefingVersionNumber: number;
	requestedByUserId: string;
	artifact: CanonicalBriefingArtifact;
	provenance: BriefingGenerationProvenance | null;
	audioAssetPath: string;
	audioStorageKey: string;
	callbacks: {
		progressPath: string;
		completePath: string;
		failPath: string;
	};
}

export interface BriefingRenderCompletionInput {
	audioAsset?: Partial<Pick<BriefingAssetLink, 'path' | 'contentType' | 'sizeBytes' | 'sha256' | 'cacheControl'>> | null;
	validation?: BriefingValidationResult | null;
	completedAt?: string | null;
}

interface BriefingRenderJobDeps {
	queryFn?: typeof query;
	executeFn?: typeof execute;
	getBriefingRecordFn?: typeof getBriefingRecord;
	getLatestBriefingVersionFn?: typeof getLatestBriefingVersion;
	getBriefingVersionFn?: typeof getBriefingVersion;
	updateBriefingVersionArtifactFn?: typeof updateBriefingVersionArtifact;
	randomIdFn?: () => string;
	buildPublishedStorageKeyFn?: typeof buildPublishedStorageKey;
}

interface BriefingRenderJobRow {
	id: string;
	job_id: string;
	briefing_version_number: number | string;
	requested_by_user_id: string;
	status: BriefingRenderJobStatus;
	error_message: string | null;
	created_at: Date | string;
	claimed_at: Date | string | null;
	completed_at: Date | string | null;
}

interface ExecuteResultLike {
	affectedRows?: number;
}

function toIsoString(value: Date | string | null) {
	if (!value) {
		return null;
	}
	return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function normalizeRequired(value: string, fieldName: string) {
	const normalized = value.trim();
	if (!normalized) {
		throw new Error(`${fieldName} is required.`);
	}
	return normalized;
}

function normalizeOptional(value: string | null | undefined) {
	if (typeof value !== 'string') {
		return null;
	}
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : null;
}

function normalizeNonNegativeInteger(value: number | null | undefined) {
	const normalized = Number(value ?? 0);
	if (!Number.isFinite(normalized)) {
		return 0;
	}
	return Math.max(0, Math.floor(normalized));
}

function normalizeRenderStage(value: string | null | undefined): BriefingRenderStage {
	const normalized = normalizeOptional(value);
	return normalized && [
		'queued',
		'rendering_narration',
		'encoding_audio',
		'assembling_briefing',
		'packaging_assets',
		'publishing_bundle',
		'completed',
		'failed'
	].includes(normalized)
		? (normalized as BriefingRenderStage)
		: 'rendering_narration';
}

function affectedRowCount(result: unknown) {
	return Number((result as ExecuteResultLike | null | undefined)?.affectedRows ?? 0);
}

function assetWithoutUrl(asset: BriefingAssetLink): BriefingAssetLink {
	return { ...asset, url: '' };
}

function buildAudioAsset(jobId: string, input: BriefingRenderCompletionInput['audioAsset'], buildPublishedStorageKeyFn: typeof buildPublishedStorageKey): { link: BriefingAssetLink; record: BriefingAssetInput } {
	const path = normalizeOptional(input?.path) ?? DEFAULT_AUDIO_ASSET_PATH;
	const link: BriefingAssetLink = {
		role: 'audio',
		path,
		url: '',
		contentType: normalizeOptional(input?.contentType) ?? DEFAULT_AUDIO_CONTENT_TYPE,
		sizeBytes: normalizeNonNegativeInteger(input?.sizeBytes),
		sha256: normalizeOptional(input?.sha256) ?? '',
		cacheControl: normalizeOptional(input?.cacheControl) ?? DEFAULT_AUDIO_CACHE_CONTROL
	};

	return {
		link,
		record: {
			role: 'audio',
			assetPath: path,
			storageKey: buildPublishedStorageKeyFn(jobId, path),
			contentType: link.contentType,
			sizeBytes: link.sizeBytes,
			sha256: link.sha256,
			cacheControl: link.cacheControl
		}
	};
}

function nextArtifactForCompletedRender(
	artifact: CanonicalBriefingArtifact,
	audioAsset: BriefingAssetLink,
	validation: BriefingValidationResult | null | undefined,
	completedAt: string | null | undefined
) {
	const otherAssets = artifact.assets.filter((asset) => asset.role !== 'audio');
	return {
		...artifact,
		generatedAt: normalizeOptional(completedAt) ?? artifact.generatedAt,
		validation: validation ?? artifact.validation,
		audioAsset: assetWithoutUrl(audioAsset),
		assets: [...otherAssets, assetWithoutUrl(audioAsset)]
	};
}

async function getRenderJobById(
	renderJobId: string,
	queryFn: typeof query
): Promise<BriefingRenderJob | null> {
	const rows = await queryFn<BriefingRenderJobRow>(
		`SELECT id,
		        job_id,
		        briefing_version_number,
		        requested_by_user_id,
		        status,
		        error_message,
		        created_at,
		        claimed_at,
		        completed_at
		 FROM briefing_render_jobs
		 WHERE id = :id
		 LIMIT 1`,
		{ id: normalizeRequired(renderJobId, 'renderJobId') }
	);

	return rows[0] ? mapRenderJob(rows[0]) : null;
}

async function loadVersionForRenderJob(
	renderJob: BriefingRenderJob,
	getBriefingVersionFn: typeof getBriefingVersion,
	executeFn: typeof execute
): Promise<BriefingVersion | null> {
	const version = await getBriefingVersionFn(renderJob.jobId, renderJob.briefingVersionNumber);
	if (version) {
		return version;
	}

	await executeFn(
		`UPDATE briefing_render_jobs
		 SET status = 'failed',
		     error_message = 'The requested canonical briefing version no longer exists.',
		     completed_at = CURRENT_TIMESTAMP,
		     updated_at = CURRENT_TIMESTAMP
		 WHERE id = :id`,
		{ id: renderJob.id }
	);
	await executeFn(
		`UPDATE briefings
		 SET state = 'failed',
		     stage = 'failed',
		     error_message = 'The requested canonical briefing version no longer exists.',
		     failed_at = CURRENT_TIMESTAMP,
		     updated_at = CURRENT_TIMESTAMP
		 WHERE job_id = :job_id`,
		{ job_id: renderJob.jobId }
	);

	return null;
}

function mapRenderJob(row: BriefingRenderJobRow): BriefingRenderJob {
	return {
		id: row.id,
		jobId: row.job_id,
		briefingVersionNumber: Number(row.briefing_version_number),
		requestedByUserId: row.requested_by_user_id,
		status: row.status,
		errorMessage: row.error_message,
		createdAt: toIsoString(row.created_at) ?? new Date(0).toISOString(),
		claimedAt: toIsoString(row.claimed_at),
		completedAt: toIsoString(row.completed_at)
	};
}


export async function enqueueBriefingRerender(jobId: string, userId: string, deps: BriefingRenderJobDeps = {}) {
	const normalizedJobId = normalizeRequired(jobId, 'jobId');
	const normalizedUserId = normalizeRequired(userId, 'userId');
	const executeFn = deps.executeFn ?? execute;
	const getBriefingRecordFn = deps.getBriefingRecordFn ?? getBriefingRecord;
	const getLatestBriefingVersionFn = deps.getLatestBriefingVersionFn ?? getLatestBriefingVersion;
	const [record, latestVersion] = await Promise.all([
		getBriefingRecordFn(normalizedJobId),
		getLatestBriefingVersionFn(normalizedJobId)
	]);

	if (!record || record.ownerUserId !== normalizedUserId) {
		return null;
	}

	if (!latestVersion) {
		return null;
	}

	await executeFn(
		`UPDATE briefing_render_jobs
		 SET status = 'cancelled',
		     error_message = 'Superseded by a newer rerender request.',
		     completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
		     updated_at = CURRENT_TIMESTAMP
		 WHERE job_id = :job_id
		   AND status IN ('queued', 'processing')`,
		{ job_id: normalizedJobId }
	);

	const id = (deps.randomIdFn ?? randomUUID)();
	await executeFn(
		`INSERT INTO briefing_render_jobs (
			id,
			job_id,
			briefing_version_number,
			requested_by_user_id,
			status
		) VALUES (
			:id,
			:job_id,
			:briefing_version_number,
			:requested_by_user_id,
			'queued'
		)`,
		{
			id,
			job_id: normalizedJobId,
			briefing_version_number: latestVersion.versionNumber,
			requested_by_user_id: normalizedUserId
		}
	);

	await executeFn(
		`UPDATE briefings
		 SET state = 'processing',
		     stage = 'queued',
		     progress_percent = 1,
		     progress_detail = 'Waiting for a renderer slot to become available.',
		     sentence_total = NULL,
		     sentence_completed = NULL,
		     error_message = NULL,
		     failed_at = NULL,
		     updated_at = CURRENT_TIMESTAMP
		 WHERE job_id = :job_id`,
		{ job_id: normalizedJobId }
	);

	return { renderJobId: id, jobId: normalizedJobId, versionNumber: latestVersion.versionNumber };
}

export async function claimNextBriefingRenderJob(deps: BriefingRenderJobDeps = {}): Promise<ClaimedBriefingRenderJob | null> {
	const queryFn = deps.queryFn ?? query;
	const executeFn = deps.executeFn ?? execute;
	const getBriefingVersionFn = deps.getBriefingVersionFn ?? getBriefingVersion;
	const buildPublishedStorageKeyFn = deps.buildPublishedStorageKeyFn ?? buildPublishedStorageKey;

	for (let attempt = 0; attempt < 5; attempt += 1) {
		const rows = await queryFn<BriefingRenderJobRow>(
			`SELECT id,
			        job_id,
			        briefing_version_number,
			        requested_by_user_id,
			        status,
			        error_message,
			        created_at,
			        claimed_at,
			        completed_at
			 FROM briefing_render_jobs
			 WHERE status = 'queued'
			 ORDER BY created_at ASC, id ASC
			 LIMIT 1`
		);

		const nextRow = rows[0];
		if (!nextRow) {
			return null;
		}

		const nextJob = mapRenderJob(nextRow);
		const claimResult = await executeFn(
			`UPDATE briefing_render_jobs
			 SET status = 'processing',
			     claimed_at = CURRENT_TIMESTAMP,
			     error_message = NULL,
			     updated_at = CURRENT_TIMESTAMP
			 WHERE id = :id AND status = 'queued'`,
			{ id: nextJob.id }
		);

		if (affectedRowCount(claimResult) === 0) {
			continue;
		}

		await executeFn(
			`UPDATE briefings
			 SET state = 'processing',
			     stage = 'rendering_narration',
			     progress_percent = 32,
			     progress_detail = 'The renderer is narrating the saved canonical briefing.',
			     sentence_total = NULL,
			     sentence_completed = NULL,
			     error_message = NULL,
			     failed_at = NULL,
			     started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
			     updated_at = CURRENT_TIMESTAMP
			 WHERE job_id = :job_id`,
			{ job_id: nextJob.jobId }
		);

		const version = await loadVersionForRenderJob(nextJob, getBriefingVersionFn, executeFn);
		if (!version) {
			continue;
		}

		return {
			renderJobId: nextJob.id,
			jobId: nextJob.jobId,
			briefingVersionNumber: nextJob.briefingVersionNumber,
			requestedByUserId: nextJob.requestedByUserId,
			artifact: version.artifact,
			provenance: version.provenance,
			audioAssetPath: DEFAULT_AUDIO_ASSET_PATH,
			audioStorageKey: buildPublishedStorageKeyFn(nextJob.jobId, DEFAULT_AUDIO_ASSET_PATH),
			callbacks: {
				progressPath: `/api/internal/briefings/render-jobs/${encodeURIComponent(nextJob.id)}/progress`,
				completePath: `/api/internal/briefings/render-jobs/${encodeURIComponent(nextJob.id)}/complete`,
				failPath: `/api/internal/briefings/render-jobs/${encodeURIComponent(nextJob.id)}/fail`
			}
		};
	}

	return null;
}

export async function markBriefingRenderJobProgress(
	renderJobId: string,
	stage: BriefingRenderStage,
	input: BriefingRenderProgressInput = {},
	deps: BriefingRenderJobDeps = {}
) {
	const queryFn = deps.queryFn ?? query;
	const executeFn = deps.executeFn ?? execute;
	const renderJob = await getRenderJobById(renderJobId, queryFn);
	if (!renderJob) {
		return null;
	}
	if (renderJob.status === 'cancelled') {
		return null;
	}

	const normalizedStage = normalizeRenderStage(stage);
	await executeFn(
		`UPDATE briefing_render_jobs
		 SET status = 'processing',
		     claimed_at = COALESCE(claimed_at, CURRENT_TIMESTAMP),
		     error_message = NULL,
		     updated_at = CURRENT_TIMESTAMP
		 WHERE id = :id`,
		{ id: renderJob.id }
	);
	await executeFn(
		`UPDATE briefings
		 SET state = 'processing',
		     stage = :stage,
		     progress_percent = :progress_percent,
		     progress_detail = :progress_detail,
		     sentence_total = :sentence_total,
		     sentence_completed = :sentence_completed,
		     error_message = NULL,
		     failed_at = NULL,
		     started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
		     updated_at = CURRENT_TIMESTAMP
		 WHERE job_id = :job_id`,
		{
			stage: normalizedStage,
			progress_percent:
				input.percent === null || input.percent === undefined
					? null
					: normalizeNonNegativeInteger(Math.min(100, input.percent)),
			progress_detail: normalizeOptional(input.detail),
			sentence_total:
				input.sentenceTotal === null || input.sentenceTotal === undefined
					? null
					: normalizeNonNegativeInteger(input.sentenceTotal),
			sentence_completed:
				input.sentenceCompleted === null || input.sentenceCompleted === undefined
					? null
					: normalizeNonNegativeInteger(input.sentenceCompleted),
			job_id: renderJob.jobId
		}
	);

	return { renderJobId: renderJob.id, jobId: renderJob.jobId, stage: normalizedStage };
}

export async function completeBriefingRenderJob(
	renderJobId: string,
	input: BriefingRenderCompletionInput = {},
	deps: BriefingRenderJobDeps = {}
) {
	const queryFn = deps.queryFn ?? query;
	const executeFn = deps.executeFn ?? execute;
	const getBriefingVersionFn = deps.getBriefingVersionFn ?? getBriefingVersion;
	const updateBriefingVersionArtifactFn = deps.updateBriefingVersionArtifactFn ?? updateBriefingVersionArtifact;
	const buildPublishedStorageKeyFn = deps.buildPublishedStorageKeyFn ?? buildPublishedStorageKey;
	const renderJob = await getRenderJobById(renderJobId, queryFn);
	if (!renderJob) {
		return null;
	}
	if (renderJob.status === 'cancelled') {
		return null;
	}

	const version = await loadVersionForRenderJob(renderJob, getBriefingVersionFn, executeFn);
	if (!version) {
		return null;
	}

	const { link: audioAsset, record: audioAssetRecord } = buildAudioAsset(renderJob.jobId, input.audioAsset, buildPublishedStorageKeyFn);
	const artifact = nextArtifactForCompletedRender(version.artifact, audioAsset, input.validation, input.completedAt);

	await updateBriefingVersionArtifactFn(renderJob.jobId, renderJob.briefingVersionNumber, artifact);
	await executeFn(
		`INSERT INTO briefing_assets (
			job_id,
			role,
			asset_path,
			storage_key,
			content_type,
			size_bytes,
			sha256,
			cache_control
		) VALUES (
			:job_id,
			:role,
			:asset_path,
			:storage_key,
			:content_type,
			:size_bytes,
			:sha256,
			:cache_control
		)
		ON DUPLICATE KEY UPDATE
			storage_key = VALUES(storage_key),
			content_type = VALUES(content_type),
			size_bytes = VALUES(size_bytes),
			sha256 = VALUES(sha256),
			cache_control = VALUES(cache_control)`,
		{
			job_id: renderJob.jobId,
			role: audioAssetRecord.role,
			asset_path: audioAssetRecord.assetPath,
			storage_key: audioAssetRecord.storageKey,
			content_type: audioAssetRecord.contentType,
			size_bytes: audioAssetRecord.sizeBytes,
			sha256: audioAssetRecord.sha256,
			cache_control: audioAssetRecord.cacheControl
		}
	);
	await executeFn(
		`UPDATE briefing_render_jobs
		 SET status = 'completed',
		     error_message = NULL,
		     completed_at = COALESCE(:completed_at, CURRENT_TIMESTAMP),
		     updated_at = CURRENT_TIMESTAMP
		 WHERE id = :id`,
		{ id: renderJob.id, completed_at: normalizeOptional(input.completedAt) }
	);
	await executeFn(
		`UPDATE briefings
		 SET state = 'ready',
		     stage = 'completed',
		     progress_percent = 100,
		     progress_detail = 'The rerendered briefing is ready.',
		     sentence_total = NULL,
		     sentence_completed = NULL,
		     error_message = NULL,
		     validation_valid = :validation_valid,
		     validation_warning_count = :validation_warning_count,
		     validation_error_count = :validation_error_count,
		     completed_at = COALESCE(:completed_at, CURRENT_TIMESTAMP),
		     failed_at = NULL,
		     updated_at = CURRENT_TIMESTAMP
		 WHERE job_id = :job_id`,
		{
			job_id: renderJob.jobId,
			completed_at: normalizeOptional(input.completedAt),
			validation_valid: artifact.validation.valid ? 1 : 0,
			validation_warning_count: artifact.validation.warnings.length,
			validation_error_count: artifact.validation.errors.length
		}
	);

	return {
		renderJobId: renderJob.id,
		jobId: renderJob.jobId,
		audioStorageKey: audioAssetRecord.storageKey,
		briefingVersionNumber: renderJob.briefingVersionNumber
	};
}

export async function failBriefingRenderJob(
	renderJobId: string,
	errorMessage: string,
	deps: BriefingRenderJobDeps = {}
) {
	const queryFn = deps.queryFn ?? query;
	const executeFn = deps.executeFn ?? execute;
	const renderJob = await getRenderJobById(renderJobId, queryFn);
	if (!renderJob) {
		return null;
	}
	if (renderJob.status === 'cancelled') {
		return null;
	}

	const normalizedError = normalizeRequired(errorMessage, 'errorMessage');
	await executeFn(
		`UPDATE briefing_render_jobs
		 SET status = 'failed',
		     error_message = :error_message,
		     completed_at = CURRENT_TIMESTAMP,
		     updated_at = CURRENT_TIMESTAMP
		 WHERE id = :id`,
		{ id: renderJob.id, error_message: normalizedError }
	);
	await executeFn(
		`UPDATE briefings
		 SET state = 'failed',
		     stage = 'failed',
		     progress_percent = 100,
		     progress_detail = :error_message,
		     sentence_total = NULL,
		     sentence_completed = NULL,
		     error_message = :error_message,
		     failed_at = CURRENT_TIMESTAMP,
		     updated_at = CURRENT_TIMESTAMP
		 WHERE job_id = :job_id`,
		{ job_id: renderJob.jobId, error_message: normalizedError }
	);

	return { renderJobId: renderJob.id, jobId: renderJob.jobId, errorMessage: normalizedError };
}

export async function getLatestBriefingRenderJob(jobId: string, deps: BriefingRenderJobDeps = {}): Promise<BriefingRenderJob | null> {
	const normalizedJobId = normalizeRequired(jobId, 'jobId');
	const queryFn = deps.queryFn ?? query;
	const rows = await queryFn<BriefingRenderJobRow>(
		`SELECT id,
		        job_id,
		        briefing_version_number,
		        requested_by_user_id,
		        status,
		        error_message,
		        created_at,
		        claimed_at,
		        completed_at
		 FROM briefing_render_jobs
		 WHERE job_id = :job_id
		 ORDER BY created_at DESC, id DESC
		 LIMIT 1`,
		{ job_id: normalizedJobId }
	);

	return rows[0] ? mapRenderJob(rows[0]) : null;
}