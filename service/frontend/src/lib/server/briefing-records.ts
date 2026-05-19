import { execute, query } from './db';

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