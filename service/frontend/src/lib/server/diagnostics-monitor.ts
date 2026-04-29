import { DiagnosticEventType, DiagnosticHop, emitDiagnosticEvent } from './diagnostics';
import { getConfig } from './env';
import { getHermesWorkerHeartbeat } from './hermes-heartbeat';

let monitorStarted = false;
let workerWasStale = false;

function checkHermesWorkerStaleness() {
  const worker = getHermesWorkerHeartbeat();
  const stale = worker.seen && !worker.isOnline;

  if (stale && !workerWasStale) {
    emitDiagnosticEvent(DiagnosticEventType.WorkerStatusStale, DiagnosticHop.HermesWorker, {
      source: worker.source,
      ageSeconds: worker.ageSeconds,
      staleAfterSeconds: worker.staleAfterSeconds,
      lastSeenAt: worker.lastSeenAt
    });
  }

  if (!stale && workerWasStale) {
    emitDiagnosticEvent(DiagnosticEventType.WorkerStatusRecovered, DiagnosticHop.HermesWorker, {
      source: worker.source,
      ageSeconds: worker.ageSeconds,
      staleAfterSeconds: worker.staleAfterSeconds,
      lastSeenAt: worker.lastSeenAt
    });
  }

  workerWasStale = stale;
}

export function startDiagnosticsMonitor() {
  if (monitorStarted) {
    return;
  }
  monitorStarted = true;

  const intervalMs = getConfig().diagnosticsStaleCheckIntervalSeconds * 1000;
  const timer = setInterval(() => {
    try {
      checkHermesWorkerStaleness();
    } catch (error) {
      console.warn('Diagnostics monitor check failed', error);
    }
  }, intervalMs);
  (timer as unknown as { unref?: () => void }).unref?.();
}

export function resetDiagnosticsMonitorForTests() {
  monitorStarted = false;
  workerWasStale = false;
}