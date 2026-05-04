const DEFAULT_POLL_INTERVAL_MS = 5_000;
const MIN_POLL_INTERVAL_MS = 2_000;
const CONNECTION_STATES = new Set(['connected', 'degraded', 'offline', 'misconfigured']);
const PENDING_EVENT_STATES = new Set(['queued', 'processing', 'acked', 'cancelled']);

export interface MaintenanceHermesConnectionStatus {
  polledAt: string;
  state: 'connected' | 'degraded' | 'offline' | 'misconfigured';
  label: string;
  summary: string;
  hermesServiceTokenConfigured: boolean;
  queue: {
    queued: number;
    processing: number;
    staleProcessing: number;
    acked: number;
    error: string | null;
  };
  workerHeartbeat: {
    seen: boolean;
    lastSeenAt: string | null;
    ageSeconds: number | null;
    staleAfterSeconds: number;
    isOnline: boolean;
    source: string | null;
    authFailure: {
      seen: boolean;
      lastSeenAt: string | null;
      ageSeconds: number | null;
      source: string | null;
      reason: string | null;
    };
  };
  pendingEvent: {
    exists: boolean;
    status: 'queued' | 'processing' | 'acked' | 'cancelled' | null;
    eventId: string | null;
    createdAt: string | null;
    ageSeconds: number | null;
  };
}

interface FetchMaintenanceHermesStatusOptions {
  basePath?: string;
  fetchImpl?: typeof fetch;
}

interface MaintenanceHermesStatusPollingOptions extends FetchMaintenanceHermesStatusOptions {
  intervalMs?: number;
  onUpdate: (status: MaintenanceHermesConnectionStatus) => void;
  onError?: (message: string | null) => void;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeBasePath(basePath = '') {
  return basePath.replace(/\/+$/, '');
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}

function isNullableNumber(value: unknown): value is number | null {
  return typeof value === 'number' || value === null;
}

function isPendingEventStatus(value: unknown): value is MaintenanceHermesConnectionStatus['pendingEvent']['status'] {
  return value === null || (typeof value === 'string' && PENDING_EVENT_STATES.has(value));
}

function isMaintenanceHermesConnectionStatus(value: unknown): value is MaintenanceHermesConnectionStatus {
  if (!isObjectRecord(value)) {
    return false;
  }

  if (
    typeof value.polledAt !== 'string' ||
    typeof value.state !== 'string' ||
    !CONNECTION_STATES.has(value.state) ||
    typeof value.label !== 'string' ||
    typeof value.summary !== 'string' ||
    typeof value.hermesServiceTokenConfigured !== 'boolean'
  ) {
    return false;
  }

  const queue = value.queue;
  const workerHeartbeat = value.workerHeartbeat;
  const pendingEvent = value.pendingEvent;

  if (
    !isObjectRecord(queue) ||
    typeof queue.queued !== 'number' ||
    typeof queue.processing !== 'number' ||
    typeof queue.staleProcessing !== 'number' ||
    typeof queue.acked !== 'number' ||
    !isNullableString(queue.error)
  ) {
    return false;
  }

  if (
    !isObjectRecord(workerHeartbeat) ||
    typeof workerHeartbeat.seen !== 'boolean' ||
    !isNullableString(workerHeartbeat.lastSeenAt) ||
    !isNullableNumber(workerHeartbeat.ageSeconds) ||
    typeof workerHeartbeat.staleAfterSeconds !== 'number' ||
    typeof workerHeartbeat.isOnline !== 'boolean' ||
    !isNullableString(workerHeartbeat.source) ||
    !isObjectRecord(workerHeartbeat.authFailure) ||
    typeof workerHeartbeat.authFailure.seen !== 'boolean' ||
    !isNullableString(workerHeartbeat.authFailure.lastSeenAt) ||
    !isNullableNumber(workerHeartbeat.authFailure.ageSeconds) ||
    !isNullableString(workerHeartbeat.authFailure.source) ||
    !isNullableString(workerHeartbeat.authFailure.reason)
  ) {
    return false;
  }

  if (
    !isObjectRecord(pendingEvent) ||
    typeof pendingEvent.exists !== 'boolean' ||
    !isPendingEventStatus(pendingEvent.status) ||
    !isNullableString(pendingEvent.eventId) ||
    !isNullableString(pendingEvent.createdAt) ||
    !isNullableNumber(pendingEvent.ageSeconds)
  ) {
    return false;
  }

  return true;
}

export function buildMaintenanceHermesStatusApiPath(basePath = '') {
  return `${normalizeBasePath(basePath)}/maintenance/status`;
}

export async function fetchMaintenanceHermesConnectionStatus(
  options: FetchMaintenanceHermesStatusOptions = {}
): Promise<MaintenanceHermesConnectionStatus> {
  const response = await (options.fetchImpl ?? fetch)(
    buildMaintenanceHermesStatusApiPath(options.basePath),
    {
      method: 'GET',
      headers: { Accept: 'application/json' }
    }
  );

  const payload = await response.json().catch(() => null);
  if (isMaintenanceHermesConnectionStatus(payload)) {
    return payload;
  }

  const fallbackMessage = response.ok
    ? 'Unable to load live Hermes connection status.'
    : `Unable to load live Hermes connection status (${response.status}).`;
  const errorMessage =
    isObjectRecord(payload) && typeof payload.error === 'string' && payload.error.trim().length > 0
      ? payload.error
      : fallbackMessage;
  throw new Error(errorMessage);
}

export function startMaintenanceHermesConnectionStatusPolling(
  options: MaintenanceHermesStatusPollingOptions
) {
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
      const status = await fetchMaintenanceHermesConnectionStatus(options);
      options.onUpdate(status);
      options.onError?.(null);
    } catch (error) {
      options.onError?.(
        error instanceof Error ? error.message : 'Unable to refresh the live Hermes status right now.'
      );
    } finally {
      inFlight = false;
      schedule();
    }
  };

  schedule();

  return () => {
    cancelled = true;
    clearTimer();
  };
}