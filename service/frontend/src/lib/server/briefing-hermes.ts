import { query } from './db';
import { getConversationOwnerId } from './chat';
import {
  getBriefingRecord,
  upsertBriefingRecord,
  type BriefingRecordInput,
  type CanonicalBriefingState
} from './briefing-records';

interface UserRow {
  id: string;
}

interface HermesBriefingInput {
  jobId?: unknown;
  conversationId?: unknown;
  title?: unknown;
  summary?: unknown;
  state?: unknown;
}

interface HermesBriefingDeps {
  getConversationOwnerIdFn?: typeof getConversationOwnerId;
  getBriefingRecordFn?: typeof getBriefingRecord;
  queryFn?: typeof query;
  upsertBriefingRecordFn?: typeof upsertBriefingRecord;
}

export class HermesBriefingRegistrationError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
  }
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeState(value: unknown): CanonicalBriefingState {
  if (value === 'ready' || value === 'failed') {
    return value;
  }
  return 'processing';
}

export async function registerBriefingFromHermes(
  input: HermesBriefingInput,
  deps: HermesBriefingDeps = {}
) {
  const jobId = optionalString(input.jobId);
  if (!jobId) {
    throw new HermesBriefingRegistrationError(
      'A briefing job id is required.',
      400,
      'BRIEFING_JOB_ID_REQUIRED'
    );
  }

  const conversationId = optionalString(input.conversationId);
  const getConversationOwnerIdFn = deps.getConversationOwnerIdFn ?? getConversationOwnerId;
  const queryFn = deps.queryFn ?? query;
  let ownerUserId: string | null = null;

  if (conversationId) {
    ownerUserId = await getConversationOwnerIdFn(conversationId);
    if (!ownerUserId) {
      throw new HermesBriefingRegistrationError(
        'The target conversation was not found.',
        404,
        'BRIEFING_CONVERSATION_NOT_FOUND'
      );
    }
  } else {
    const users = await queryFn<UserRow>('SELECT id FROM users ORDER BY id ASC LIMIT 2');
    ownerUserId = users.length === 1 ? users[0].id : null;
    if (!ownerUserId) {
      throw new HermesBriefingRegistrationError(
        'Briefing ownership could not be resolved.',
        409,
        'BRIEFING_OWNER_UNRESOLVED'
      );
    }
  }

  const existing = await (deps.getBriefingRecordFn ?? getBriefingRecord)(jobId);
  if (existing && existing.ownerUserId !== ownerUserId) {
    throw new HermesBriefingRegistrationError(
      'The briefing is already owned by another user.',
      409,
      'BRIEFING_OWNER_CONFLICT'
    );
  }

  const requestedState = normalizeState(input.state);
  const state =
    existing && existing.state !== 'processing' && requestedState === 'processing'
      ? existing.state
      : requestedState;
  const record: BriefingRecordInput = {
    jobId,
    ownerUserId,
    conversationId: conversationId ?? existing?.conversationId ?? null,
    sourceMessageId: existing?.sourceMessageId,
    briefingId: existing?.briefingId,
    title: optionalString(input.title) ?? existing?.title,
    summary: optionalString(input.summary) ?? existing?.summary,
    state,
    stage: existing?.stage,
    progressPercent: existing?.progressPercent,
    progressDetail: existing?.progressDetail,
    sentenceTotal: existing?.sentenceTotal,
    sentenceCompleted: existing?.sentenceCompleted,
    manifestStorageKey: existing?.manifestStorageKey,
    statusStorageKey: existing?.statusStorageKey,
    errorMessage: existing?.errorMessage,
    validationValid: existing?.validationValid,
    validationWarningCount: existing?.validationWarningCount,
    validationErrorCount: existing?.validationErrorCount,
    startedAt: existing?.startedAt,
    completedAt: existing?.completedAt,
    failedAt: existing?.failedAt
  };
  await (deps.upsertBriefingRecordFn ?? upsertBriefingRecord)(record);

  return record;
}
