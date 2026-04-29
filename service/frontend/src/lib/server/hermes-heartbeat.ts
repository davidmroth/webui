import { getConfig } from './env';
import { DiagnosticEventType, DiagnosticHop, emitDiagnosticEvent } from './diagnostics';

type HeartbeatSource =
  | 'inbox-next'
  | 'event-ack'
  | 'assistant-post'
  | 'context'
  | 'health'
  | 'commands'
  | 'typing'
  | 'typing-stop';

let lastSeenAtMs: number | null = null;
let lastSeenSource: HeartbeatSource | null = null;
let lastAuthFailureAtMs: number | null = null;
let lastAuthFailureSource: HeartbeatSource | null = null;
let lastAuthFailureReason: string | null = null;

export function noteHermesWorkerHeartbeat(source: HeartbeatSource) {
  lastSeenAtMs = Date.now();
  lastSeenSource = source;
  emitDiagnosticEvent(DiagnosticEventType.HermesWorkerSeen, DiagnosticHop.HermesWorker, {
    source,
    lastSeenAt: new Date(lastSeenAtMs).toISOString()
  });
}

export function noteHermesWorkerAuthFailure(source: HeartbeatSource, reason = 'unauthorized') {
  lastAuthFailureAtMs = Date.now();
  lastAuthFailureSource = source;
  lastAuthFailureReason = reason.trim() || 'unauthorized';
  emitDiagnosticEvent(DiagnosticEventType.HermesAuthFailed, DiagnosticHop.HermesWorker, {
    source,
    reason: lastAuthFailureReason,
    lastSeenAt: new Date(lastAuthFailureAtMs).toISOString()
  });
}

export function getHermesWorkerHeartbeat() {
  const staleAfterSeconds = getConfig().hermesWorkerHeartbeatStaleSeconds;
  const authFailure = {
    seen: Boolean(lastAuthFailureAtMs),
    lastSeenAt: lastAuthFailureAtMs ? new Date(lastAuthFailureAtMs).toISOString() : null,
    ageSeconds: lastAuthFailureAtMs
      ? Math.max(0, Math.floor((Date.now() - lastAuthFailureAtMs) / 1000))
      : null,
    source: lastAuthFailureSource,
    reason: lastAuthFailureReason
  };

  if (!lastSeenAtMs) {
    return {
      seen: false,
      lastSeenAt: null,
      ageSeconds: null,
      staleAfterSeconds,
      isOnline: false,
      source: null as HeartbeatSource | null,
      authFailure
    };
  }

  const ageSeconds = Math.max(0, Math.floor((Date.now() - lastSeenAtMs) / 1000));

  return {
    seen: true,
    lastSeenAt: new Date(lastSeenAtMs).toISOString(),
    ageSeconds,
    staleAfterSeconds,
    isOnline: ageSeconds <= staleAfterSeconds,
    source: lastSeenSource,
    authFailure
  };
}
