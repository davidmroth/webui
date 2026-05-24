import { execute, query } from './db';
import type {
	BriefingGenerationProvenance,
	BriefingVersionCreationReason,
	CanonicalBriefingArtifact
} from './briefing-artifact';

export type CanonicalBriefingState = 'processing' | 'ready' | 'failed';

export interface BriefingRecordInput {
	jobId: string;
	ownerUserId: string;
	conversationId?: string | null;
	sourceMessageId?: string | null;
	briefingId?: string | null;
	title?: string | null;
	summary?: string | null;
	state?: CanonicalBriefingState;
	stage?: string | null;
	progressPercent?: number | null;
	progressDetail?: string | null;
	sentenceTotal?: number | null;
	sentenceCompleted?: number | null;
	manifestStorageKey?: string | null;
	statusStorageKey?: string | null;
	errorMessage?: string | null;
	validationValid?: boolean;
	validationWarningCount?: number;
	validationErrorCount?: number;
	startedAt?: string | null;
	completedAt?: string | null;
	failedAt?: string | null;
}

export interface BriefingAssetInput {
	role: string;
	assetPath: string;
	storageKey: string;
	contentType?: string | null;
	sizeBytes?: number;
	sha256?: string | null;
	cacheControl?: string | null;
}

export interface BriefingRecord {
	jobId: string;
	ownerUserId: string;
	conversationId: string | null;
	sourceMessageId: string | null;
	briefingId: string | null;
	title: string | null;
	summary: string | null;
	state: CanonicalBriefingState;
	stage: string | null;
	progressPercent: number | null;
	progressDetail: string | null;
	sentenceTotal: number | null;
	sentenceCompleted: number | null;
	manifestStorageKey: string | null;
	statusStorageKey: string | null;
	errorMessage: string | null;
	validationValid: boolean;
	validationWarningCount: number;
	validationErrorCount: number;
	createdAt: string;
	updatedAt: string;
	startedAt: string | null;
	completedAt: string | null;
	failedAt: string | null;
}

interface BriefingRecordRow {
	job_id: string;
	owner_user_id: string;
	conversation_id: string | null;
	source_message_id: string | null;
	briefing_id: string | null;
	title: string | null;
	summary: string | null;
	state: CanonicalBriefingState;
	stage: string | null;
	progress_percent: number | string | null;
	progress_detail: string | null;
	sentence_total: number | string | null;
	sentence_completed: number | string | null;
	manifest_storage_key: string | null;
	status_storage_key: string | null;
	error_message: string | null;
	validation_valid: number | boolean;
	validation_warning_count: number | string;
	validation_error_count: number | string;
	created_at: Date | string;
	updated_at: Date | string;
	started_at: Date | string | null;
	completed_at: Date | string | null;
	failed_at: Date | string | null;
}

interface BriefingRecordDeps {
	executeFn?: typeof execute;
	queryFn?: typeof query;
}

export interface BriefingVersionInput {
	jobId: string;
	versionNumber: number;
	artifactSchemaVersion: string;
	artifact: CanonicalBriefingArtifact;
	provenance?: BriefingGenerationProvenance | null;
	creationReason?: BriefingVersionCreationReason;
	createdByProvider?: string | null;
	createdByModel?: string | null;
}

export interface BriefingVersion {
	id: number;
	jobId: string;
	versionNumber: number;
	artifactSchemaVersion: string;
	artifact: CanonicalBriefingArtifact;
	provenance: BriefingGenerationProvenance | null;
	creationReason: BriefingVersionCreationReason;
	createdByProvider: string | null;
	createdByModel: string | null;
	createdAt: string;
}

interface BriefingVersionRow {
	id: number | string;
	job_id: string;
	version_number: number | string;
	artifact_schema_version: string;
	artifact_json: string | CanonicalBriefingArtifact;
	provenance_json: string | BriefingGenerationProvenance | null;
	creation_reason: BriefingVersionCreationReason;
	created_by_provider: string | null;
	created_by_model: string | null;
	created_at: Date | string;
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

function toIsoString(value: Date | string | null) {
	if (!value) {
		return null;
	}
	return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function normalizePositiveInteger(value: number, fieldName: string) {
	const normalized = Number(value);
	if (!Number.isInteger(normalized) || normalized < 1) {
		throw new Error(`${fieldName} must be a positive integer.`);
	}
	return normalized;
}

function normalizeJsonDocument<T>(value: T | null | undefined, fieldName: string) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${fieldName} must be an object.`);
	}
	return value;
}

function parseJsonColumn<T>(value: string | T | null, fieldName: string): T | null {
	if (value === null) {
		return null;
	}

	if (typeof value === 'string') {
		try {
			return JSON.parse(value) as T;
		} catch {
			throw new Error(`${fieldName} is not valid JSON.`);
		}
	}

	if (typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${fieldName} must decode to an object.`);
	}

	return value;
}

function mapBriefingRecord(row: BriefingRecordRow): BriefingRecord {
	return {
		jobId: row.job_id,
		ownerUserId: row.owner_user_id,
		conversationId: row.conversation_id,
		sourceMessageId: row.source_message_id,
		briefingId: row.briefing_id,
		title: row.title,
		summary: row.summary,
		state: row.state,
		stage: row.stage,
		progressPercent: row.progress_percent === null ? null : normalizeNonNegativeInteger(Number(row.progress_percent)),
		progressDetail: row.progress_detail,
		sentenceTotal: row.sentence_total === null ? null : normalizeNonNegativeInteger(Number(row.sentence_total)),
		sentenceCompleted: row.sentence_completed === null ? null : normalizeNonNegativeInteger(Number(row.sentence_completed)),
		manifestStorageKey: row.manifest_storage_key,
		statusStorageKey: row.status_storage_key,
		errorMessage: row.error_message,
		validationValid: row.validation_valid === true || row.validation_valid === 1,
		validationWarningCount: normalizeNonNegativeInteger(Number(row.validation_warning_count)),
		validationErrorCount: normalizeNonNegativeInteger(Number(row.validation_error_count)),
		createdAt: toIsoString(row.created_at) ?? new Date(0).toISOString(),
		updatedAt: toIsoString(row.updated_at) ?? new Date(0).toISOString(),
		startedAt: toIsoString(row.started_at),
		completedAt: toIsoString(row.completed_at),
		failedAt: toIsoString(row.failed_at)
	};
}

function mapBriefingVersion(row: BriefingVersionRow): BriefingVersion {
	return {
		id: Number(row.id),
		jobId: row.job_id,
		versionNumber: Number(row.version_number),
		artifactSchemaVersion: row.artifact_schema_version,
		artifact: parseJsonColumn<CanonicalBriefingArtifact>(row.artifact_json, 'artifact_json')!,
		provenance: parseJsonColumn<BriefingGenerationProvenance>(row.provenance_json, 'provenance_json'),
		creationReason: row.creation_reason,
		createdByProvider: row.created_by_provider,
		createdByModel: row.created_by_model,
		createdAt: toIsoString(row.created_at) ?? new Date(0).toISOString()
	};
}

export async function upsertBriefingRecord(
	input: BriefingRecordInput,
	deps: BriefingRecordDeps = {}
) {
	const executeFn = deps.executeFn ?? execute;
	const jobId = normalizeRequired(input.jobId, 'jobId');
	const ownerUserId = normalizeRequired(input.ownerUserId, 'ownerUserId');

	await executeFn(
		`INSERT INTO briefings (
			job_id,
			owner_user_id,
			conversation_id,
			source_message_id,
			briefing_id,
			title,
			summary,
			state,
			stage,
			progress_percent,
			progress_detail,
			sentence_total,
			sentence_completed,
			manifest_storage_key,
			status_storage_key,
			error_message,
			validation_valid,
			validation_warning_count,
			validation_error_count,
			started_at,
			completed_at,
			failed_at
		) VALUES (
			:job_id,
			:owner_user_id,
			:conversation_id,
			:source_message_id,
			:briefing_id,
			:title,
			:summary,
			:state,
			:stage,
			:progress_percent,
			:progress_detail,
			:sentence_total,
			:sentence_completed,
			:manifest_storage_key,
			:status_storage_key,
			:error_message,
			:validation_valid,
			:validation_warning_count,
			:validation_error_count,
			:started_at,
			:completed_at,
			:failed_at
		)
		ON DUPLICATE KEY UPDATE
			owner_user_id = VALUES(owner_user_id),
			conversation_id = VALUES(conversation_id),
			source_message_id = VALUES(source_message_id),
			briefing_id = VALUES(briefing_id),
			title = VALUES(title),
			summary = VALUES(summary),
			state = VALUES(state),
			stage = VALUES(stage),
			progress_percent = VALUES(progress_percent),
			progress_detail = VALUES(progress_detail),
			sentence_total = VALUES(sentence_total),
			sentence_completed = VALUES(sentence_completed),
			manifest_storage_key = VALUES(manifest_storage_key),
			status_storage_key = VALUES(status_storage_key),
			error_message = VALUES(error_message),
			validation_valid = VALUES(validation_valid),
			validation_warning_count = VALUES(validation_warning_count),
			validation_error_count = VALUES(validation_error_count),
			started_at = VALUES(started_at),
			completed_at = VALUES(completed_at),
			failed_at = VALUES(failed_at),
			updated_at = CURRENT_TIMESTAMP`,
		{
			job_id: jobId,
			owner_user_id: ownerUserId,
			conversation_id: normalizeOptional(input.conversationId),
			source_message_id: normalizeOptional(input.sourceMessageId),
			briefing_id: normalizeOptional(input.briefingId),
			title: normalizeOptional(input.title),
			summary: normalizeOptional(input.summary),
			state: input.state ?? 'processing',
			stage: normalizeOptional(input.stage),
			progress_percent: input.progressPercent === null || input.progressPercent === undefined ? null : normalizeNonNegativeInteger(input.progressPercent),
			progress_detail: normalizeOptional(input.progressDetail),
			sentence_total: input.sentenceTotal === null || input.sentenceTotal === undefined ? null : normalizeNonNegativeInteger(input.sentenceTotal),
			sentence_completed: input.sentenceCompleted === null || input.sentenceCompleted === undefined ? null : normalizeNonNegativeInteger(input.sentenceCompleted),
			manifest_storage_key: normalizeOptional(input.manifestStorageKey),
			status_storage_key: normalizeOptional(input.statusStorageKey),
			error_message: normalizeOptional(input.errorMessage),
			validation_valid: input.validationValid === false ? 0 : 1,
			validation_warning_count: normalizeNonNegativeInteger(input.validationWarningCount),
			validation_error_count: normalizeNonNegativeInteger(input.validationErrorCount),
			started_at: normalizeOptional(input.startedAt),
			completed_at: normalizeOptional(input.completedAt),
			failed_at: normalizeOptional(input.failedAt)
		}
	);

	return jobId;
}

export async function upsertBriefingAssets(
	jobId: string,
	assets: BriefingAssetInput[],
	deps: BriefingRecordDeps = {}
) {
	const executeFn = deps.executeFn ?? execute;
	const normalizedJobId = normalizeRequired(jobId, 'jobId');

	for (const asset of assets) {
		const role = normalizeRequired(asset.role, 'role');
		const assetPath = normalizeRequired(asset.assetPath, 'assetPath');
		const storageKey = normalizeRequired(asset.storageKey, 'storageKey');
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
				job_id: normalizedJobId,
				role,
				asset_path: assetPath,
				storage_key: storageKey,
				content_type: normalizeOptional(asset.contentType),
				size_bytes: normalizeNonNegativeInteger(asset.sizeBytes),
				sha256: normalizeOptional(asset.sha256),
				cache_control: normalizeOptional(asset.cacheControl)
			}
		);
	}
	return assets.length;
}

export async function createBriefingVersion(
	input: BriefingVersionInput,
	deps: BriefingRecordDeps = {}
) {
	const executeFn = deps.executeFn ?? execute;
	const jobId = normalizeRequired(input.jobId, 'jobId');
	const versionNumber = normalizePositiveInteger(input.versionNumber, 'versionNumber');
	const artifactSchemaVersion = normalizeRequired(input.artifactSchemaVersion, 'artifactSchemaVersion');
	const artifact = normalizeJsonDocument(input.artifact, 'artifact');
	const provenance = input.provenance ? normalizeJsonDocument(input.provenance, 'provenance') : null;

	await executeFn(
		`INSERT INTO briefing_versions (
			job_id,
			version_number,
			artifact_schema_version,
			artifact_json,
			provenance_json,
			creation_reason,
			created_by_provider,
			created_by_model
		) VALUES (
			:job_id,
			:version_number,
			:artifact_schema_version,
			:artifact_json,
			:provenance_json,
			:creation_reason,
			:created_by_provider,
			:created_by_model
		)
		ON DUPLICATE KEY UPDATE
			artifact_schema_version = VALUES(artifact_schema_version),
			artifact_json = VALUES(artifact_json),
			provenance_json = VALUES(provenance_json),
			creation_reason = VALUES(creation_reason),
			created_by_provider = VALUES(created_by_provider),
			created_by_model = VALUES(created_by_model)`,
		{
			job_id: jobId,
			version_number: versionNumber,
			artifact_schema_version: artifactSchemaVersion,
			artifact_json: JSON.stringify(artifact),
			provenance_json: provenance ? JSON.stringify(provenance) : null,
			creation_reason: input.creationReason ?? 'initial_generation',
			created_by_provider: normalizeOptional(input.createdByProvider),
			created_by_model: normalizeOptional(input.createdByModel)
		}
	);

	return { jobId, versionNumber };
}

export async function getLatestBriefingVersion(
	jobId: string,
	deps: BriefingRecordDeps = {}
): Promise<BriefingVersion | null> {
	const queryFn = deps.queryFn ?? query;
	const normalizedJobId = normalizeRequired(jobId, 'jobId');
	const rows = await queryFn<BriefingVersionRow>(
		`SELECT id,
		        job_id,
		        version_number,
		        artifact_schema_version,
		        artifact_json,
		        provenance_json,
		        creation_reason,
		        created_by_provider,
		        created_by_model,
		        created_at
		 FROM briefing_versions
		 WHERE job_id = :job_id
		 ORDER BY version_number DESC, id DESC
		 LIMIT 1`,
		{ job_id: normalizedJobId }
	);

	return rows[0] ? mapBriefingVersion(rows[0]) : null;
}

export async function getBriefingVersion(
	jobId: string,
	versionNumber: number,
	deps: BriefingRecordDeps = {}
): Promise<BriefingVersion | null> {
	const queryFn = deps.queryFn ?? query;
	const normalizedJobId = normalizeRequired(jobId, 'jobId');
	const normalizedVersionNumber = normalizePositiveInteger(versionNumber, 'versionNumber');
	const rows = await queryFn<BriefingVersionRow>(
		`SELECT id,
		        job_id,
		        version_number,
		        artifact_schema_version,
		        artifact_json,
		        provenance_json,
		        creation_reason,
		        created_by_provider,
		        created_by_model,
		        created_at
		 FROM briefing_versions
		 WHERE job_id = :job_id AND version_number = :version_number
		 LIMIT 1`,
		{ job_id: normalizedJobId, version_number: normalizedVersionNumber }
	);

	return rows[0] ? mapBriefingVersion(rows[0]) : null;
}

export async function updateBriefingVersionArtifact(
	jobId: string,
	versionNumber: number,
	artifact: CanonicalBriefingArtifact,
	deps: BriefingRecordDeps = {}
) {
	const executeFn = deps.executeFn ?? execute;
	const normalizedJobId = normalizeRequired(jobId, 'jobId');
	const normalizedVersionNumber = normalizePositiveInteger(versionNumber, 'versionNumber');
	const normalizedArtifact = normalizeJsonDocument(artifact, 'artifact');

	await executeFn(
		`UPDATE briefing_versions
		 SET artifact_schema_version = :artifact_schema_version,
		     artifact_json = :artifact_json
		 WHERE job_id = :job_id AND version_number = :version_number`,
		{
			job_id: normalizedJobId,
			version_number: normalizedVersionNumber,
			artifact_schema_version: normalizeRequired(normalizedArtifact.schemaVersion, 'artifact.schemaVersion'),
			artifact_json: JSON.stringify(normalizedArtifact)
		}
	);

	return { jobId: normalizedJobId, versionNumber: normalizedVersionNumber };
}

export async function getBriefingRecord(
	jobId: string,
	deps: BriefingRecordDeps = {}
): Promise<BriefingRecord | null> {
	const queryFn = deps.queryFn ?? query;
	const normalizedJobId = normalizeRequired(jobId, 'jobId');
	const rows = await queryFn<BriefingRecordRow>(
		`SELECT job_id,
		        owner_user_id,
		        conversation_id,
		        source_message_id,
		        briefing_id,
		        title,
		        summary,
		        state,
		        stage,
		        progress_percent,
		        progress_detail,
		        sentence_total,
		        sentence_completed,
		        manifest_storage_key,
		        status_storage_key,
		        error_message,
		        validation_valid,
		        validation_warning_count,
		        validation_error_count,
		        created_at,
		        updated_at,
		        started_at,
		        completed_at,
		        failed_at
		 FROM briefings
		 WHERE job_id = :job_id
		 LIMIT 1`,
		{ job_id: normalizedJobId }
	);

	return rows[0] ? mapBriefingRecord(rows[0]) : null;
}

export async function getBriefingRecordByIdentifier(
	identifier: string,
	deps: BriefingRecordDeps = {}
): Promise<BriefingRecord | null> {
	const queryFn = deps.queryFn ?? query;
	const normalizedIdentifier = normalizeRequired(identifier, 'identifier');
	const rows = await queryFn<BriefingRecordRow>(
		`SELECT job_id,
		        owner_user_id,
		        conversation_id,
		        source_message_id,
		        briefing_id,
		        title,
		        summary,
		        state,
		        stage,
		        progress_percent,
		        progress_detail,
		        sentence_total,
		        sentence_completed,
		        manifest_storage_key,
		        status_storage_key,
		        error_message,
		        validation_valid,
		        validation_warning_count,
		        validation_error_count,
		        created_at,
		        updated_at,
		        started_at,
		        completed_at,
		        failed_at
		 FROM briefings
		 WHERE job_id = :identifier OR briefing_id = :identifier
		 ORDER BY CASE WHEN job_id = :identifier THEN 0 ELSE 1 END
		 LIMIT 1`,
		{ identifier: normalizedIdentifier }
	);

	return rows[0] ? mapBriefingRecord(rows[0]) : null;
}