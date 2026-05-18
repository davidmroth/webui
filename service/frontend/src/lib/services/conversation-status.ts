import type { ConversationRunState } from '$lib/types-legacy';
import {
  type MaintenanceHermesConnectionStatus,
  isMaintenanceHermesConnectionStatus
} from './maintenance-hermes-status';

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const MIN_POLL_INTERVAL_MS = 2_000;
const RUN_STATES = new Set(['idle', 'queued', 'processing', 'completed', 'failed', 'cancelled', 'stale']);

export interface ConversationStatusSnapshot {
  assistantBusy: boolean;
  assistantStalled: boolean;
  runState: ConversationRunState;
  hermesConnection: MaintenanceHermesConnectionStatus;
}

interface FetchConversationStatusOptions {
  conversationId: string;
  fetchImpl?: typeof fetch;
}

interface ConversationStatusPollingOptions extends FetchConversationStatusOptions {
  intervalMs?: number;
  onUpdate: (status: ConversationStatusSnapshot) => void;
  onError?: (message: string | null) => void;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null | undefined {
  return typeof value === 'string' || value === null || typeof value === 'undefined';
}

function isConversationRunState(value: unknown): value is ConversationRunState {
  if (!isObjectRecord(value)) {
    return false;
  }

  return (
    typeof value.active === 'boolean' &&
    typeof value.stalled === 'boolean' &&
    typeof value.status === 'string' &&
    RUN_STATES.has(value.status) &&
    isNullableString(value.eventId) &&
    isNullableString(value.messageId) &&
    isNullableString(value.createdAt) &&
    isNullableString(value.claimedAt) &&
    isNullableString(value.completedAt) &&
    isNullableString(value.lastActivityAt) &&
    isNullableString(value.errorCode) &&
    isNullableString(value.errorMessage)
  );
}

function isConversationStatusSnapshot(value: unknown): value is ConversationStatusSnapshot {
  if (!isObjectRecord(value)) {
    return false;
  }

  return (
    typeof value.assistantBusy === 'boolean' &&
    typeof value.assistantStalled === 'boolean' &&
    isConversationRunState(value.runState) &&
    isMaintenanceHermesConnectionStatus(value.hermesConnection)
  );
}

export async function fetchConversationStatus(
  options: FetchConversationStatusOptions
): Promise<ConversationStatusSnapshot> {
  const response = await (options.fetchImpl ?? fetch)(
    `/api/conversations/${options.conversationId}/status`,
    {
      method: 'GET',
      headers: { Accept: 'application/json' }
    }
  );

  const payload = await response.json().catch(() => null);
  if (isConversationStatusSnapshot(payload)) {
    return payload;
  }

  const fallbackMessage = response.ok
    ? 'Unable to load live conversation status.'
    : `Unable to load live conversation status (${response.status}).`;
  const errorMessage =
    isObjectRecord(payload) && typeof payload.error === 'string' && payload.error.trim().length > 0
      ? payload.error
      : fallbackMessage;
  throw new Error(errorMessage);
}

export function startConversationStatusPolling(options: ConversationStatusPollingOptions) {
  if (typeof window === 'undefined') {
    return () => {};
  }

  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  const intervalMs = Math.max(MIN_POLL_INTERVAL_MS, options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS);

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const schedule = () => {
    if (cancelled) {
      return;
    }
    clearTimer();
    timer = setTimeout(runPoll, intervalMs);
  };

  const runPoll = async () => {
    if (cancelled || inFlight) {
      return;
    }
    inFlight = true;

    try {
      const status = await fetchConversationStatus(options);
      options.onUpdate(status);
      options.onError?.(null);
    } catch (error) {
      options.onError?.(
        error instanceof Error ? error.message : 'Unable to refresh the conversation status right now.'
      );
    } finally {
      inFlight = false;
      schedule();
    }
  };

  void runPoll();

  return () => {
    cancelled = true;
    clearTimer();
  };
}