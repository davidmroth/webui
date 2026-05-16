import type { BriefingReference } from '$lib/types-legacy';
import { query } from './db';

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

interface BriefingListDeps {
  queryFn?: <T>(sql: string, params?: Record<string, unknown>) => Promise<T[]>;
}

export interface BriefingListEntry {
  conversationId: string;
  conversationTitle: string;
  createdAt: string;
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

export async function listBriefingsForUser(
  userId: string,
  options: { page?: number; pageSize?: number } & BriefingListDeps = {}
): Promise<BriefingListResult> {
  const queryFn = options.queryFn ?? query;
  const pageSize = clampInteger(options.pageSize ?? 12, 1, 100);

  const [countRow] = await queryFn<BriefingCountRow>(
    `SELECT COUNT(DISTINCT JSON_UNQUOTE(JSON_EXTRACT(messages.extra, '$.briefingReference.jobId'))) AS total
     FROM messages
     INNER JOIN conversations ON conversations.id = messages.conversation_id
     WHERE conversations.user_id = :user_id
       AND messages.role = 'assistant'
       AND JSON_UNQUOTE(JSON_EXTRACT(messages.extra, '$.briefingReference.jobId')) IS NOT NULL`,
    { user_id: userId }
  );

  const total = Math.max(0, Number(countRow?.total ?? 0) || 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = clampInteger(options.page ?? 1, 1, totalPages);
  const offset = (page - 1) * pageSize;

  const rows = total
    ? await queryFn<BriefingListRow>(
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
         ORDER BY sort_at DESC, messages.created_at DESC, messages.id DESC
         LIMIT :limit OFFSET :offset`,
        {
          user_id: userId,
          limit: pageSize,
          offset
        }
      )
    : [];

  const items = rows
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

  return {
    items,
    page,
    pageSize,
    total,
    totalPages,
    hasPreviousPage: page > 1,
    hasNextPage: page < totalPages
  };
}