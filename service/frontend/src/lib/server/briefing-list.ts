import { execute, query } from './db';
import { getBriefingObjectBuffer, listBriefingObjectKeys, removeBriefingObjects } from './storage';
import { findBriefingOwnerUserId } from './briefing-sharing';
import {
  buildBriefingReferenceFromRecord,
  buildPublishedStoragePrefix,
  syncBriefingCatalogFromStorage,
  syncBriefingJobFromStorage
} from './briefing-catalog';

interface BriefingCountRow {
  total: number | string;
}

interface BriefingListRow {
  job_id: string;
  briefing_id: string | null;
  title: string | null;
  summary: string | null;
  state: 'processing' | 'ready' | 'failed';
  validation_valid: number | boolean;
  validation_warning_count: number | string;
  validation_error_count: number | string;
  conversation_id: string;
  conversation_title: string | null;
  sort_at: string;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
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
  state: 'ready' | 'processing' | 'failed';
  reference: ReturnType<typeof buildBriefingReferenceFromRecord>;
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

function mapBriefingListRow(userId: string, row: BriefingListRow): BriefingListEntry {
		const record = {
			jobId: row.job_id,
			ownerUserId: userId,
			conversationId: row.conversation_id,
			sourceMessageId: null,
			briefingId: row.briefing_id,
			title: row.title,
			summary: row.summary,
			state: row.state,
			stage: null,
			manifestStorageKey: null,
			statusStorageKey: null,
			errorMessage: null,
			validationValid: normalizeBoolean(row.validation_valid),
			validationWarningCount: normalizeNonNegativeInteger(row.validation_warning_count),
			validationErrorCount: normalizeNonNegativeInteger(row.validation_error_count),
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			startedAt: row.started_at,
			completedAt: row.completed_at,
			failedAt: row.failed_at
		};

	return {
		conversationId: row.conversation_id,
		conversationTitle: row.conversation_title,
		createdAt: row.sort_at,
		isPublic: Boolean(row.is_public),
		state: row.state,
		reference: buildBriefingReferenceFromRecord(record)
	} satisfies BriefingListEntry;
}

const BRIEFING_LIST_SELECT = `SELECT briefings.job_id,
            briefings.briefing_id,
            briefings.title,
            briefings.summary,
            briefings.state,
            briefings.validation_valid,
            briefings.validation_warning_count,
            briefings.validation_error_count,
            briefings.created_at,
            briefings.updated_at,
            briefings.started_at,
            briefings.completed_at,
            briefings.failed_at,
            conversations.id AS conversation_id,
            conversations.title AS conversation_title,
            COALESCE(briefings.completed_at, briefings.failed_at, briefings.started_at, briefings.created_at) AS sort_at,
            briefing_shares.is_public AS is_public
     FROM briefings
     LEFT JOIN conversations ON conversations.id = briefings.conversation_id
     LEFT JOIN briefing_shares
       ON briefing_shares.job_id = briefings.job_id
     WHERE briefings.owner_user_id = :user_id`;

async function countDbBriefingsForUser(
  userId: string,
  queryFn: NonNullable<BriefingListDeps['queryFn']>
): Promise<number> {
  const [row] = await queryFn<BriefingCountRow>(
    `SELECT COUNT(*) AS total
     FROM briefings
     WHERE briefings.owner_user_id = :user_id`,
    { user_id: userId }
  );

  return normalizeNonNegativeInteger(row?.total);
}

async function listDbBriefingsForUserPage(
  userId: string,
  options: {
    page: number;
    pageSize: number;
    queryFn: NonNullable<BriefingListDeps['queryFn']>;
  }
): Promise<BriefingListResult> {
  const total = await countDbBriefingsForUser(userId, options.queryFn);
  const totalPages = Math.max(1, Math.ceil(total / options.pageSize));
  const safePage = clampInteger(options.page, 1, totalPages);
  const offset = (safePage - 1) * options.pageSize;

  const rows = await options.queryFn<BriefingListRow>(
    `${BRIEFING_LIST_SELECT}
     ORDER BY sort_at DESC, briefings.updated_at DESC, briefings.job_id DESC
     LIMIT :limit OFFSET :offset`,
    {
      user_id: userId,
      limit: options.pageSize,
      offset
    }
  );

  return {
    items: rows.map((row) => mapBriefingListRow(userId, row)),
    page: safePage,
    pageSize: options.pageSize,
    total,
    totalPages,
    hasPreviousPage: safePage > 1,
    hasNextPage: safePage < totalPages
  };
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

export async function assertBriefingOwnedByUser(
  userId: string,
  jobId: string,
  options: Pick<BriefingListDeps, 'queryFn'> = {}
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
  await syncBriefingJobFromStorage(normalizedJobId, { queryFn });
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
}

export async function listBriefingsForUser(
  userId: string,
  options: { page?: number; pageSize?: number; syncFromStorage?: boolean } & BriefingListDeps = {}
): Promise<BriefingListResult> {
  const queryFn: NonNullable<BriefingListDeps['queryFn']> = options.queryFn ?? query;
  const executeFn: NonNullable<BriefingListDeps['executeFn']> = options.executeFn ?? execute;
  const pageSize = clampInteger(options.pageSize ?? 12, 1, 100);
  if (options.syncFromStorage) {
    try {
      await syncBriefingCatalogFromStorage({
        queryFn: queryFn as unknown as typeof query,
        executeFn,
        listObjectKeysFn: options.listObjectKeysFn ?? listBriefingObjectKeys,
        readObjectBufferFn: options.readObjectBufferFn ?? getBriefingObjectBuffer
      } as Parameters<typeof syncBriefingCatalogFromStorage>[0]);
    } catch {
      // Ignore sync failures and serve the last known DB state.
    }
  }

  return listDbBriefingsForUserPage(userId, {
    page: options.page ?? 1,
    pageSize,
    queryFn
  });
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

  await assertBriefingOwnedByUser(normalizedUserId, normalizedJobId, { queryFn });

  const prefix = buildPublishedStoragePrefix(normalizedJobId);
  const storageKeys = await listObjectKeysFn(prefix);
  await deleteObjectKeysFn(storageKeys);
  await executeFn('DELETE FROM briefing_shares WHERE job_id = :job_id', { job_id: normalizedJobId });
  await executeFn('DELETE FROM briefings WHERE job_id = :job_id', { job_id: normalizedJobId });
}