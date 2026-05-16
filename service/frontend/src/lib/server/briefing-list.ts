import type { BriefingReference } from '$lib/types-legacy';
import { execute, query } from './db';
import { getBriefingObjectBuffer, listBriefingObjectKeys, removeBriefingObjects } from './storage';
import { getConfig } from './env';
import { findBriefingOwnerUserId } from './briefing-sharing';

interface BriefingCountRow {
  total: number | string;
}

interface BriefingListRow {
  conversation_id: string;
  conversation_title: string;
  sort_at: string;
  extra: string | Record<string, unknown> | null;
  is_public: number | null;
}

interface BriefingShareRow {
  job_id: string;
  owner_user_id: string;
  is_public: number | boolean;
}

interface UserCountRow {
  total: number | string;
}

interface StoredBriefingManifestSummary {
  jobId: string;
  briefingId: string;
  title: string;
  summary: string | null;
  generatedAt: string | null;
  validation: {
    valid: boolean;
    warningCount: number;
    errorCount: number;
  };
}

interface StoredBriefingStatusSummary {
	jobId: string;
	briefingId: string;
	title: string;
	summary: string | null;
	generatedAt: string | null;
	validation: {
		valid: boolean;
		warningCount: number;
		errorCount: number;
	};
}

interface BriefingListDeps {
  queryFn?: <T>(sql: string, params?: Record<string, unknown>) => Promise<T[]>;
  executeFn?: (sql: string, params?: Record<string, unknown>) => Promise<unknown>;
  listObjectKeysFn?: (prefix?: string) => Promise<string[]>;
  readObjectBufferFn?: (storageKey: string) => Promise<Buffer>;
  deleteObjectKeysFn?: (storageKeys: string[]) => Promise<void>;
}

export interface BriefingListEntry {
  conversationId: string | null;
  conversationTitle: string | null;
  createdAt: string | null;
  isPublic: boolean;
  reference: BriefingReference;
}

export interface BriefingListResult {
  items: BriefingListEntry[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
}

function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, Math.floor(value)));
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

function normalizeBoolean(value: unknown): boolean {
  return value === true || value === 1;
}

function parseMessageExtra(extra: string | Record<string, unknown> | null) {
  if (!extra) {
    return null;
  }

  if (typeof extra === 'object') {
    return extra;
  }

  try {
    const parsed = JSON.parse(extra);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseBriefingReference(extra: string | Record<string, unknown> | null): BriefingReference | null {
  const parsedExtra = parseMessageExtra(extra);
  const raw = parsedExtra?.briefingReference;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const source = raw as Record<string, unknown>;
  const jobId = normalizeOptionalString(source.jobId);
  const briefingId = normalizeOptionalString(source.briefingId);
  const title = normalizeOptionalString(source.title);

  if (!jobId || !briefingId || !title) {
    return null;
  }

  const validationSource =
    source.validation && typeof source.validation === 'object' && !Array.isArray(source.validation)
      ? (source.validation as Record<string, unknown>)
      : {};

  return {
    schemaVersion: 'briefing-reference/v1',
    jobId,
    briefingId,
    title,
    summary: normalizeOptionalString(source.summary),
    generatedAt: normalizeOptionalString(source.generatedAt),
    previewUrl:
      normalizeOptionalString(source.previewUrl) ?? `/briefings/${encodeURIComponent(jobId)}/player`,
    standaloneHtmlUrl:
      normalizeOptionalString(source.standaloneHtmlUrl) ?? `/briefings/${encodeURIComponent(jobId)}`,
    validation: {
      valid: validationSource.valid !== false,
      warningCount: normalizeNonNegativeInteger(validationSource.warningCount),
      errorCount: normalizeNonNegativeInteger(validationSource.errorCount)
    }
  };
}

function normalizeStoragePrefix(value: string) {
  return value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

function buildPublishedStoragePrefix(jobId = '') {
  const prefix = normalizeStoragePrefix(getConfig().briefingStoragePrefix);
  if (!jobId.trim()) {
    return prefix;
  }

  return prefix ? `${prefix}/${jobId.trim()}` : jobId.trim();
}

function buildPublishedStorageKey(jobId: string, assetPath: string) {
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

function parseStoredBriefingManifest(jobId: string, buffer: Buffer): StoredBriefingManifestSummary | null {
  const parsed = parseJsonRecord(buffer);
  if (!parsed) {
    return null;
  }

  const briefingId = normalizeOptionalString(parsed.briefing_id);
  const title = normalizeOptionalString(parsed.title);
  if (!briefingId || !title) {
    return null;
  }

  const validationSource =
    parsed.validation && typeof parsed.validation === 'object' && !Array.isArray(parsed.validation)
      ? (parsed.validation as Record<string, unknown>)
      : {};

  const warnings = Array.isArray(validationSource.warnings) ? validationSource.warnings.length : 0;
  const errors = Array.isArray(validationSource.errors) ? validationSource.errors.length : 0;

  return {
    jobId,
    briefingId,
    title,
    summary: normalizeOptionalString(parsed.summary),
    generatedAt: normalizeOptionalString(parsed.generated_at),
    validation: {
      valid: validationSource.valid !== false,
      warningCount: warnings,
      errorCount: errors
    }
  };
}

function titleFromBriefingId(briefingId: string) {
  return briefingId
    .trim()
    .split(/[-_]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function parseStoredBriefingStatus(jobId: string, buffer: Buffer): StoredBriefingStatusSummary | null {
  const parsed = parseJsonRecord(buffer);
  if (!parsed) {
    return null;
  }

  const briefingId = normalizeOptionalString(parsed.briefing_id);
  if (!briefingId) {
    return null;
  }

  const validationSource =
    parsed.validation && typeof parsed.validation === 'object' && !Array.isArray(parsed.validation)
      ? (parsed.validation as Record<string, unknown>)
      : {};

  const warnings = Array.isArray(validationSource.warnings) ? validationSource.warnings.length : 0;
  const errors = Array.isArray(validationSource.errors) ? validationSource.errors.length : 0;
  const title =
    normalizeOptionalString(parsed.title) ??
    titleFromBriefingId(briefingId) ??
    briefingId;

  return {
    jobId,
    briefingId,
    title,
    summary: null,
    generatedAt:
      normalizeOptionalString(parsed.completed_at) ??
      normalizeOptionalString(parsed.created_at),
    validation: {
      valid: validationSource.valid !== false,
      warningCount: warnings,
      errorCount: errors
    }
  };
}

function toBriefingReferenceFromManifest(manifest: StoredBriefingManifestSummary): BriefingReference {
  return {
    schemaVersion: 'briefing-reference/v1',
    jobId: manifest.jobId,
    briefingId: manifest.briefingId,
    title: manifest.title,
    summary: manifest.summary,
    generatedAt: manifest.generatedAt,
    previewUrl: `/briefings/${encodeURIComponent(manifest.jobId)}/player`,
    standaloneHtmlUrl: `/briefings/${encodeURIComponent(manifest.jobId)}`,
    validation: manifest.validation
  };
}

function toBriefingReferenceFromStatus(status: StoredBriefingStatusSummary): BriefingReference {
  return {
    schemaVersion: 'briefing-reference/v1',
    jobId: status.jobId,
    briefingId: status.briefingId,
    title: status.title,
    summary: status.summary,
    generatedAt: status.generatedAt,
    previewUrl: `/briefings/${encodeURIComponent(status.jobId)}/player`,
    standaloneHtmlUrl: `/briefings/${encodeURIComponent(status.jobId)}`,
    validation: status.validation
  };
}

function compareBriefingsDescending(left: BriefingListEntry, right: BriefingListEntry) {
  const leftTime = Date.parse(left.reference.generatedAt ?? left.createdAt ?? '');
  const rightTime = Date.parse(right.reference.generatedAt ?? right.createdAt ?? '');

  const normalizedLeft = Number.isFinite(leftTime) ? leftTime : 0;
  const normalizedRight = Number.isFinite(rightTime) ? rightTime : 0;
  return normalizedRight - normalizedLeft;
}

function paginateBriefings(items: BriefingListEntry[], page: number, pageSize: number): BriefingListResult {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = clampInteger(page, 1, totalPages);
  const offset = (safePage - 1) * pageSize;

  return {
    items: items.slice(offset, offset + pageSize),
    page: safePage,
    pageSize,
    total,
    totalPages,
    hasPreviousPage: safePage > 1,
    hasNextPage: safePage < totalPages
  };
}

function buildJobIdParams(jobIds: string[], prefix: string) {
  const placeholders: string[] = [];
  const params: Record<string, unknown> = {};
  jobIds.forEach((jobId, index) => {
    const key = `${prefix}_${index}`;
    placeholders.push(`:${key}`);
    params[key] = jobId;
  });

  return {
    clause: placeholders.join(', '),
    params
  };
}

async function listDbBriefingsForUser(
  userId: string,
  queryFn: NonNullable<BriefingListDeps['queryFn']>
): Promise<BriefingListEntry[]> {
  const rows = await queryFn<BriefingListRow>(
    `SELECT conversations.id AS conversation_id,
            conversations.title AS conversation_title,
            COALESCE(messages.msg_timestamp, messages.created_at) AS sort_at,
            messages.extra,
            briefing_shares.is_public AS is_public
     FROM messages
     INNER JOIN conversations ON conversations.id = messages.conversation_id
     LEFT JOIN briefing_shares
       ON briefing_shares.job_id = JSON_UNQUOTE(JSON_EXTRACT(messages.extra, '$.briefingReference.jobId'))
     WHERE conversations.user_id = :user_id
       AND messages.role = 'assistant'
       AND JSON_UNQUOTE(JSON_EXTRACT(messages.extra, '$.briefingReference.jobId')) IS NOT NULL
       AND messages.id = (
         SELECT candidate.id
         FROM messages AS candidate
         INNER JOIN conversations AS candidate_conversations
           ON candidate_conversations.id = candidate.conversation_id
         WHERE candidate_conversations.user_id = :user_id
           AND candidate.role = 'assistant'
           AND JSON_UNQUOTE(JSON_EXTRACT(candidate.extra, '$.briefingReference.jobId')) =
               JSON_UNQUOTE(JSON_EXTRACT(messages.extra, '$.briefingReference.jobId'))
         ORDER BY COALESCE(candidate.msg_timestamp, candidate.created_at) DESC,
                  candidate.created_at DESC,
                  candidate.id DESC
         LIMIT 1
       )
     ORDER BY sort_at DESC, messages.created_at DESC, messages.id DESC`,
    { user_id: userId }
  );

  return rows
    .map((row) => {
      const reference = parseBriefingReference(row.extra);
      if (!reference) {
        return null;
      }

      return {
        conversationId: row.conversation_id,
        conversationTitle: row.conversation_title,
        createdAt: row.sort_at,
        isPublic: Boolean(row.is_public),
        reference
      } satisfies BriefingListEntry;
    })
    .filter((item): item is BriefingListEntry => item !== null);
}

async function loadShareRowsForJobs(
  jobIds: string[],
  queryFn: NonNullable<BriefingListDeps['queryFn']>
): Promise<Map<string, { ownerUserId: string; isPublic: boolean }>> {
  if (jobIds.length === 0) {
    return new Map();
  }

  const { clause, params } = buildJobIdParams(jobIds, 'job_id');
  const rows = await queryFn<BriefingShareRow>(
    `SELECT job_id, owner_user_id, is_public
     FROM briefing_shares
     WHERE job_id IN (${clause})`,
    params
  );

  return new Map(
    rows.map((row) => [
      row.job_id,
      {
        ownerUserId: row.owner_user_id,
        isPublic: normalizeBoolean(row.is_public)
      }
    ])
  );
}

async function loadVisibleStorageJobs(
  userId: string,
  jobIds: string[],
  dbJobIds: Set<string>,
  queryFn: NonNullable<BriefingListDeps['queryFn']>
): Promise<Map<string, { isPublic: boolean }>> {
  const shareRows = await loadShareRowsForJobs(jobIds, queryFn);
  const visible = new Map<string, { isPublic: boolean }>();

  for (const jobId of jobIds) {
    if (dbJobIds.has(jobId)) {
      const share = shareRows.get(jobId);
      visible.set(jobId, { isPublic: share?.isPublic ?? false });
    }
  }

  const unmatchedJobIds = jobIds.filter((jobId) => !visible.has(jobId));
  if (unmatchedJobIds.length === 0) {
    return visible;
  }

  const [countRow] = await queryFn<UserCountRow>('SELECT COUNT(*) AS total FROM users');
  const userCount = Math.max(0, Number(countRow?.total ?? 0) || 0);
  if (userCount <= 1) {
    for (const jobId of unmatchedJobIds) {
      const share = shareRows.get(jobId);
      visible.set(jobId, { isPublic: share?.isPublic ?? false });
    }
    return visible;
  }

  for (const jobId of unmatchedJobIds) {
    const share = shareRows.get(jobId);
    if (share?.ownerUserId === userId) {
      visible.set(jobId, { isPublic: share.isPublic });
    }
  }

  return visible;
}

async function listStoredBriefingManifests(
  deps: Required<Pick<BriefingListDeps, 'listObjectKeysFn' | 'readObjectBufferFn'>>
) {
  const manifestKeys = (await deps.listObjectKeysFn(buildPublishedStoragePrefix()))
    .filter((key) => key.endsWith('/briefing.json'));
  const prefix = buildPublishedStoragePrefix();
  const uniqueJobIds = Array.from(
    new Set(
      manifestKeys
        .map((key) => {
          const relativeKey = prefix ? key.replace(`${prefix}/`, '') : key;
          const segments = relativeKey.split('/');
          return segments.length === 2 && segments[1] === 'briefing.json' ? segments[0] : null;
        })
        .filter((jobId): jobId is string => Boolean(jobId))
    )
  );

  const manifests = await Promise.all(
    uniqueJobIds.map(async (jobId) => {
      try {
        const buffer = await deps.readObjectBufferFn(buildPublishedStorageKey(jobId, 'briefing.json'));
        return parseStoredBriefingManifest(jobId, buffer);
      } catch {
        return null;
      }
    })
  );

  return manifests.filter((manifest): manifest is StoredBriefingManifestSummary => manifest !== null);
}

async function listStoredBriefingStatuses(
  deps: Required<Pick<BriefingListDeps, 'listObjectKeysFn' | 'readObjectBufferFn'>>
) {
  const statusKeys = (await deps.listObjectKeysFn(buildPublishedStoragePrefix()))
    .filter((key) => key.endsWith('/status.json'));
  const prefix = buildPublishedStoragePrefix();
  const uniqueJobIds = Array.from(
    new Set(
      statusKeys
        .map((key) => {
          const relativeKey = prefix ? key.replace(`${prefix}/`, '') : key;
          const segments = relativeKey.split('/');
          return segments.length === 2 && segments[1] === 'status.json' ? segments[0] : null;
        })
        .filter((jobId): jobId is string => Boolean(jobId))
    )
  );

  const statuses = await Promise.all(
    uniqueJobIds.map(async (jobId) => {
      try {
        const buffer = await deps.readObjectBufferFn(buildPublishedStorageKey(jobId, 'status.json'));
        return parseStoredBriefingStatus(jobId, buffer);
      } catch {
        return null;
      }
    })
  );

  return statuses.filter((status): status is StoredBriefingStatusSummary => status !== null);
}

export async function listBriefingsForUser(
  userId: string,
  options: { page?: number; pageSize?: number } & BriefingListDeps = {}
): Promise<BriefingListResult> {
  const queryFn = options.queryFn ?? query;
  const pageSize = clampInteger(options.pageSize ?? 12, 1, 100);
  const dbItems = await listDbBriefingsForUser(userId, queryFn);
  const dbByJobId = new Map(dbItems.map((item) => [item.reference.jobId, item]));
  const storageDeps = {
    listObjectKeysFn: options.listObjectKeysFn ?? listBriefingObjectKeys,
    readObjectBufferFn: options.readObjectBufferFn ?? getBriefingObjectBuffer
  };

  let storageManifests: StoredBriefingManifestSummary[] = [];
  let storageStatuses: StoredBriefingStatusSummary[] = [];
  try {
    [storageManifests, storageStatuses] = await Promise.all([
      listStoredBriefingManifests(storageDeps),
      listStoredBriefingStatuses(storageDeps)
    ]);
  } catch {
    storageManifests = [];
    storageStatuses = [];
  }

  if (storageManifests.length === 0 && storageStatuses.length === 0) {
    return paginateBriefings(dbItems.sort(compareBriefingsDescending), options.page ?? 1, pageSize);
  }

  const statusOnlyByJobId = new Map(
		storageStatuses
			.filter((status) => !dbByJobId.has(status.jobId) && !storageManifests.some((manifest) => manifest.jobId === status.jobId))
			.map((status) => [status.jobId, status])
	);
  const storageJobIds = Array.from(
		new Set([
			...storageManifests.map((manifest) => manifest.jobId),
			...statusOnlyByJobId.keys()
		])
	);

  const visibleStorageJobs = await loadVisibleStorageJobs(
    userId,
    storageJobIds,
    new Set(dbByJobId.keys()),
    queryFn
  );

  const items = storageManifests
    .filter((manifest) => visibleStorageJobs.has(manifest.jobId))
    .map((manifest) => {
      const dbItem = dbByJobId.get(manifest.jobId);
      const visibility = visibleStorageJobs.get(manifest.jobId);

      return {
        conversationId: dbItem?.conversationId ?? null,
        conversationTitle: dbItem?.conversationTitle ?? null,
        createdAt: dbItem?.createdAt ?? manifest.generatedAt,
        isPublic: dbItem?.isPublic ?? visibility?.isPublic ?? false,
        reference: dbItem?.reference ?? toBriefingReferenceFromManifest(manifest)
      } satisfies BriefingListEntry;
    })
    .concat(
      Array.from(statusOnlyByJobId.values())
        .filter((status) => visibleStorageJobs.has(status.jobId))
        .map((status) => ({
          conversationId: null,
          conversationTitle: 'Renderer briefing job',
          createdAt: status.generatedAt,
          isPublic: visibleStorageJobs.get(status.jobId)?.isPublic ?? false,
          reference: toBriefingReferenceFromStatus(status)
        }) satisfies BriefingListEntry)
    )
      .concat(dbItems.filter((item) => !visibleStorageJobs.has(item.reference.jobId)))
    .sort(compareBriefingsDescending);

  return paginateBriefings(items, options.page ?? 1, pageSize);
}

export async function deleteBriefingForUser(
  userId: string,
  jobId: string,
  options: BriefingListDeps = {}
) {
  const normalizedUserId = userId.trim();
  const normalizedJobId = jobId.trim();
  if (!normalizedUserId) {
    throw new Error('An authenticated user is required.');
  }
  if (!normalizedJobId) {
    throw new Error('A briefing job id is required.');
  }

  const queryFn = options.queryFn ?? query;
  const executeFn = options.executeFn ?? execute;
  const listObjectKeysFn = options.listObjectKeysFn ?? listBriefingObjectKeys;
  const deleteObjectKeysFn = options.deleteObjectKeysFn ?? removeBriefingObjects;

  const shareRows = await loadShareRowsForJobs([normalizedJobId], queryFn);
  const share = shareRows.get(normalizedJobId);
  const ownerUserId = share?.ownerUserId ?? (await findBriefingOwnerUserId(normalizedJobId, { queryFn }));

  if (ownerUserId && ownerUserId !== normalizedUserId) {
    throw new Error('Only the briefing owner can delete it.');
  }

  if (!ownerUserId) {
    const [countRow] = await queryFn<UserCountRow>('SELECT COUNT(*) AS total FROM users');
    const userCount = Math.max(0, Number(countRow?.total ?? 0) || 0);
    if (userCount > 1) {
      throw new Error('Briefing ownership could not be verified for deletion.');
    }
  }

  const prefix = buildPublishedStoragePrefix(normalizedJobId);
  const storageKeys = await listObjectKeysFn(prefix);
  await deleteObjectKeysFn(storageKeys);
  await executeFn('DELETE FROM briefing_shares WHERE job_id = :job_id', { job_id: normalizedJobId });
}