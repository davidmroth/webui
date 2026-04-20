import { getConfig } from './env';

type HeartbeatSource = 'inbox-next' | 'event-ack' | 'assistant-post' | 'health';

let lastSeenAtMs: number | null = null;
let lastSeenSource: HeartbeatSource | null = null;

export function noteHermesWorkerHeartbeat(source: HeartbeatSource) {
  lastSeenAtMs = Date.now();
  lastSeenSource = source;
}

export function getHermesWorkerHeartbeat() {
  if (!lastSeenAtMs) {
    return {
      seen: false,
      lastSeenAt: null,
      ageSeconds: null,
      staleAfterSeconds: getConfig().hermesWorkerHeartbeatStaleSeconds,
      isOnline: false,
      source: null as HeartbeatSource | null
    };
  }

  const ageSeconds = Math.max(0, Math.floor((Date.now() - lastSeenAtMs) / 1000));
  const staleAfterSeconds = getConfig().hermesWorkerHeartbeatStaleSeconds;

  return {
    seen: true,
    lastSeenAt: new Date(lastSeenAtMs).toISOString(),
    ageSeconds,
    staleAfterSeconds,
    isOnline: ageSeconds <= staleAfterSeconds,
    source: lastSeenSource
  };
}
