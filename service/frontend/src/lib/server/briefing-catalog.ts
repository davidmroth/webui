import type { BriefingReference } from '$lib/types-legacy';
import { getConfig } from './env';
import { execute, query } from './db';
import { getBriefingObjectBuffer, listBriefingObjectKeys } from './storage';
import {
	getBriefingRecord,
	type BriefingAssetInput,
	type BriefingRecord,
	upsertBriefingAssets,
	upsertBriefingRecord
} from './briefing-records';

type QueryFn = <T>(sql: string, params?: Record<string, unknown>) => Promise<T[]>;

interface RendererValidationResult {
	valid?: unknown;
	warnings?: unknown;
	errors?: unknown;
}

interface RendererHostedAsset {
	role?: unknown;
	path?: unknown;
	content_type?: unknown;
	size_bytes?: unknown;
	sha256?: unknown;
	cache_control?: unknown;
}

interface RendererBriefingResult {
	job_id?: unknown;
	briefing_id?: unknown;
	title?: unknown;
	summary?: unknown;
	generated_at?: unknown;
	assets?: unknown;
	validation?: RendererValidationResult;
}

interface RendererJobStatus {
	job_id?: unknown;
	briefing_id?: unknown;
	title?: unknown;
	status?: unknown;
	stage?: unknown;
	created_at?: unknown;
	completed_at?: unknown;
	error?: unknown;
	validation?: RendererValidationResult | null;
}

interface BriefingShareOwnerRow {
	owner_user_id: string;
}

interface SoleUserRow {
	id: string;
}

interface SyncDeps {
	queryFn?: QueryFn;
	executeFn?: typeof execute;
	listObjectKeysFn?: (prefix?: string) => Promise<string[]>;
	readObjectBufferFn?: (storageKey: string) => Promise<Buffer>;
	upsertBriefingRecordFn?: typeof upsertBriefingRecord;
	upsertBriefingAssetsFn?: typeof upsertBriefingAssets;
	getBriefingRecordFn?: typeof getBriefingRecord;
	defaultOwnerUserId?: string | null;
}

function normalizeOptionalString(value: unknown): string | null {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeNonNegativeInteger(value: unknown): number {
	const normalized = Number(value);
	if (!Number.isFinite(normalized)) {
		return 0;
	}
	return Math.max(0, Math.floor(normalized));
}

function normalizeStoragePrefix(value: string) {
	return value
		.trim()
		.replace(/\\/g, '/')
		.replace(/^\/+/, '')
		.replace(/\/+$/, '');
}

export function buildPublishedStoragePrefix(jobId = '') {
	const prefix = normalizeStoragePrefix(getConfig().briefingStoragePrefix);
	if (!jobId.trim()) {
		return prefix;
	}
	return prefix ? `${prefix}/${jobId.trim()}` : jobId.trim();
}

export function buildPublishedStorageKey(jobId: string, assetPath: string) {
	const prefix = buildPublishedStoragePrefix(jobId);
	return prefix ? `${prefix}/${assetPath}` : assetPath;
}

function parseJsonRecord(buffer: Buffer) {
	try {
		const parsed = JSON.parse(buffer.toString('utf-8'));
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function titleFromBriefingId(briefingId: string) {
	return briefingId
		.trim()
		.split(/[-_]+/)
		.filter(Boolean)
		.map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
		.join(' ');
}

function normalizeValidation(value: RendererValidationResult | null | undefined) {
	const warnings = Array.isArray(value?.warnings)
		? value.warnings.filter((warning): warning is string => typeof warning === 'string')
		: [];
	const errors = Array.isArray(value?.errors)
		? value.errors.filter((error): error is string => typeof error === 'string')
		: [];
	return {
		valid: value?.valid !== false,
		warnings,
		errors
	};
}

function shouldSyncBriefingAsset(role: string) {
	return role !== 'standalone_html' && role !== 'player_css' && role !== 'player_js';
}

function manifestAssetInputs(jobId: string, manifest: RendererBriefingResult): BriefingAssetInput[] {
	const assetInputs: BriefingAssetInput[] = Array.isArray(manifest.assets)
		? manifest.assets
				.filter((asset): asset is RendererHostedAsset => Boolean(asset) && typeof asset === 'object')
				.filter((asset) => shouldSyncBriefingAsset(normalizeOptionalString(asset.role) ?? 'asset'))
				.flatMap((asset): BriefingAssetInput[] => {
					const role = normalizeOptionalString(asset.role) ?? 'asset';
					const assetPath = normalizeOptionalString(asset.path);
					if (!assetPath) {
						return [];
					}
					return [
						{
							role,
							assetPath,
							storageKey: buildPublishedStorageKey(jobId, assetPath),
							contentType: normalizeOptionalString(asset.content_type),
							sizeBytes: normalizeNonNegativeInteger(asset.size_bytes),
							sha256: normalizeOptionalString(asset.sha256),
							cacheControl: normalizeOptionalString(asset.cache_control)
						}
					];
				})
		: [];

	assetInputs.push({
		role: 'manifest',
		assetPath: 'briefing.json',
		storageKey: buildPublishedStorageKey(jobId, 'briefing.json'),
		contentType: 'application/vnd.hermes.briefing+json; charset=utf-8',
		cacheControl: 'private, max-age=0, must-revalidate'
	});

	return assetInputs;
}

function statusState(status: RendererJobStatus) {
	const normalizedStatus = normalizeOptionalString(status.status)?.toLowerCase();
	const validation = normalizeValidation(status.validation ?? null);
	const publishTimedOut = validation.warnings.some((warning) =>
		/object-storage publishing timed out|publishing timed out/i.test(warning)
	);
	if (normalizedStatus === 'failed' || publishTimedOut) {
		return 'failed' as const;
	}
	if (normalizedStatus === 'completed') {
		return 'processing' as const;
	}
	return 'processing' as const;
}

function mergeValidations(
	manifestValidation: ReturnType<typeof normalizeValidation> | null,
	statusValidation: ReturnType<typeof normalizeValidation> | null
) {
	const warnings = Array.from(
		new Set([...(manifestValidation?.warnings ?? []), ...(statusValidation?.warnings ?? [])])
	);
	const errors = Array.from(
		new Set([...(manifestValidation?.errors ?? []), ...(statusValidation?.errors ?? [])])
	);

	return {
		valid: (manifestValidation?.valid ?? true) && (statusValidation?.valid ?? true),
		warnings,
		errors
	};
}

async function resolveOwnerUserId(
	jobId: string,
	existing: BriefingRecord | null,
	queryFn: QueryFn,
	defaultOwnerUserId?: string | null
) {
	if (existing?.ownerUserId) {
		return existing.ownerUserId;
	}
	if (defaultOwnerUserId?.trim()) {
		return defaultOwnerUserId.trim();
	}
	const shareRows = await queryFn<BriefingShareOwnerRow>(
		`SELECT owner_user_id
		 FROM briefing_shares
		 WHERE job_id = :job_id
		 LIMIT 1`,
		{ job_id: jobId }
	);
	if (shareRows[0]?.owner_user_id) {
		return shareRows[0].owner_user_id;
	}
	const soleUsers = await queryFn<SoleUserRow>('SELECT id FROM users ORDER BY id ASC LIMIT 2');
	return soleUsers.length === 1 ? soleUsers[0].id : null;
}

async function readManifest(jobId: string, readObjectBufferFn: NonNullable<SyncDeps['readObjectBufferFn']>) {
	try {
		const buffer = await readObjectBufferFn(buildPublishedStorageKey(jobId, 'briefing.json'));
		return parseJsonRecord(buffer) as RendererBriefingResult | null;
	} catch {
		return null;
	}
}

async function readStatus(jobId: string, readObjectBufferFn: NonNullable<SyncDeps['readObjectBufferFn']>) {
	try {
		const buffer = await readObjectBufferFn(buildPublishedStorageKey(jobId, 'status.json'));
		return parseJsonRecord(buffer) as RendererJobStatus | null;
	} catch {
		return null;
	}
}

function mergeRecordInput(
	jobId: string,
	ownerUserId: string,
	existing: BriefingRecord | null,
	manifest: RendererBriefingResult | null,
	status: RendererJobStatus | null
) {
	const manifestValidation = manifest ? normalizeValidation(manifest.validation) : null;
	const statusValidation = status ? normalizeValidation(status.validation ?? null) : null;
	const effectiveValidation = mergeValidations(manifestValidation, statusValidation);
	const effectiveBriefingId =
		normalizeOptionalString(manifest?.briefing_id) ??
		normalizeOptionalString(status?.briefing_id) ??
		existing?.briefingId ??
		jobId;
	const effectiveTitle =
		normalizeOptionalString(manifest?.title) ??
		normalizeOptionalString(status?.title) ??
		existing?.title ??
		titleFromBriefingId(effectiveBriefingId);
	const statusDerivedState = status ? statusState(status) : null;
	const effectiveState = statusDerivedState === 'failed'
		? 'failed'
		: manifest
			? 'ready'
			: statusDerivedState ?? existing?.state ?? 'processing';
	const completedAt = normalizeOptionalString(manifest?.generated_at) ?? normalizeOptionalString(status?.completed_at) ?? existing?.completedAt;
	const failedAt = effectiveState === 'failed'
		? normalizeOptionalString(status?.completed_at) ?? existing?.failedAt ?? completedAt
		: null;

	return {
		jobId,
		ownerUserId,
		conversationId: existing?.conversationId ?? null,
		sourceMessageId: existing?.sourceMessageId ?? null,
		briefingId: effectiveBriefingId,
		title: effectiveTitle,
		summary: normalizeOptionalString(manifest?.summary) ?? existing?.summary,
		state: effectiveState,
		stage: normalizeOptionalString(status?.stage) ?? (manifest ? 'completed' : existing?.stage),
		manifestStorageKey: manifest ? buildPublishedStorageKey(jobId, 'briefing.json') : existing?.manifestStorageKey,
		statusStorageKey: status ? buildPublishedStorageKey(jobId, 'status.json') : existing?.statusStorageKey,
		errorMessage: normalizeOptionalString(status?.error) ?? (effectiveState === 'failed' ? existing?.errorMessage : null),
		validationValid: effectiveValidation.valid,
		validationWarningCount: effectiveValidation.warnings.length,
		validationErrorCount: effectiveValidation.errors.length,
		startedAt: normalizeOptionalString(status?.created_at) ?? existing?.startedAt,
		completedAt,
		failedAt
	};
}

export function buildBriefingReferenceFromRecord(record: BriefingRecord): BriefingReference {
	return {
		schemaVersion: 'briefing-reference/v1',
		jobId: record.jobId,
		briefingId: record.briefingId ?? record.jobId,
		title: record.title ?? titleFromBriefingId(record.briefingId ?? record.jobId),
		summary: record.summary,
		generatedAt: record.completedAt ?? record.startedAt ?? record.createdAt,
		previewUrl: `/briefings/${encodeURIComponent(record.jobId)}/player`,
		standaloneHtmlUrl: `/briefings/${encodeURIComponent(record.jobId)}`,
		validation: {
			valid: record.validationValid,
			warningCount: record.validationWarningCount,
			errorCount: record.validationErrorCount
		}
	};
}

export async function syncBriefingJobFromStorage(jobId: string, deps: SyncDeps = {}) {
	const normalizedJobId = jobId.trim();
	if (!normalizedJobId) {
		return null;
	}

	const queryFn = deps.queryFn ?? query;
	const executeFn = deps.executeFn ?? execute;
	const readObjectBufferFn = deps.readObjectBufferFn ?? getBriefingObjectBuffer;
	const getBriefingRecordFn = deps.getBriefingRecordFn ?? ((targetJobId: string) => getBriefingRecord(targetJobId, { queryFn }));
	const upsertBriefingRecordFn =
		deps.upsertBriefingRecordFn ??
		((input) => upsertBriefingRecord(input, { executeFn, queryFn }));
	const upsertBriefingAssetsFn =
		deps.upsertBriefingAssetsFn ??
		((targetJobId, assets) => upsertBriefingAssets(targetJobId, assets, { executeFn, queryFn }));

	const [existing, manifest, status] = await Promise.all([
		getBriefingRecordFn(normalizedJobId),
		readManifest(normalizedJobId, readObjectBufferFn),
		readStatus(normalizedJobId, readObjectBufferFn)
	]);

	if (!existing && !manifest && !status) {
		return null;
	}

	const ownerUserId = await resolveOwnerUserId(
		normalizedJobId,
		existing,
		queryFn,
		deps.defaultOwnerUserId
	);
	if (!ownerUserId) {
		return existing;
	}

	await upsertBriefingRecordFn(
		mergeRecordInput(normalizedJobId, ownerUserId, existing, manifest, status),
		deps
	);

	const assets: BriefingAssetInput[] = [];
	if (manifest) {
		assets.push(...manifestAssetInputs(normalizedJobId, manifest));
	}
	if (status) {
		assets.push({
			role: 'status',
			assetPath: 'status.json',
			storageKey: buildPublishedStorageKey(normalizedJobId, 'status.json'),
			contentType: 'application/json; charset=utf-8',
			cacheControl: 'private, max-age=0, must-revalidate'
		});
	}
	if (assets.length > 0) {
		await upsertBriefingAssetsFn(normalizedJobId, assets, deps);
	}

	return getBriefingRecordFn(normalizedJobId);
}

export async function syncBriefingCatalogFromStorage(deps: SyncDeps = {}) {
	const listObjectKeysFn = deps.listObjectKeysFn ?? listBriefingObjectKeys;
	const prefix = buildPublishedStoragePrefix();
	let objectKeys: string[] = [];
	try {
		objectKeys = await listObjectKeysFn(prefix);
	} catch {
		return [];
	}

	const jobIds = Array.from(
		new Set(
			objectKeys
				.filter((key) => key.endsWith('/briefing.json') || key.endsWith('/status.json'))
				.map((key) => {
					const relativeKey = prefix ? key.replace(`${prefix}/`, '') : key;
					const segments = relativeKey.split('/');
					return segments.length === 2 ? segments[0] : null;
				})
				.filter((jobId): jobId is string => Boolean(jobId))
		)
	);

	const synced = await Promise.all(jobIds.map((jobId) => syncBriefingJobFromStorage(jobId, deps)));
	return synced.filter((record): record is BriefingRecord => record !== null);
}