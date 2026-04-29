import { json } from '@sveltejs/kit';
import {
  DiagnosticEventType,
  DiagnosticHop,
  emitDiagnosticEvent,
  type DiagnosticEventTypeValue,
  type DiagnosticHopValue
} from '$server/diagnostics';
import { requireDiagnosticsToken } from '$server/diagnostics-auth';
import { query } from '$server/db';
import { getHermesQueueStats } from '$server/chat';
import { getHermesWorkerHeartbeat } from '$server/hermes-heartbeat';
import { createStorageClient } from '$server/storage';
import { getConfig } from '$server/env';

function errorDetails(error: unknown) {
  return {
    errorClass: error instanceof Error ? error.constructor.name : typeof error,
    errorMessage: error instanceof Error ? error.message : 'Unknown probe error'
  };
}

async function probeDatabase() {
  await query('SELECT 1 AS ok');
}

async function probeStorage() {
  const config = getConfig();
  const client = createStorageClient();
  await client.bucketExists(config.objectStorageBucket);
}

async function probeQueue() {
  return getHermesQueueStats();
}

async function probeWorker() {
  return getHermesWorkerHeartbeat();
}

export async function POST({ params, request }) {
  const denied = requireDiagnosticsToken(request);
  if (denied) {
    return denied;
  }

  const target = String(params.target ?? '').trim();
  const startedAt = Date.now();
  try {
    let data: unknown = null;
    let hop: DiagnosticHopValue = DiagnosticHop.WebuiApi;
    let successType: DiagnosticEventTypeValue = DiagnosticEventType.DatabaseProbeSucceeded;
    if (target === 'database') {
      hop = DiagnosticHop.Database;
      successType = DiagnosticEventType.DatabaseProbeSucceeded;
      await probeDatabase();
    } else if (target === 'storage') {
      hop = DiagnosticHop.ObjectStorage;
      successType = DiagnosticEventType.StorageProbeSucceeded;
      await probeStorage();
    } else if (target === 'queue') {
      hop = DiagnosticHop.HermesQueue;
      successType = DiagnosticEventType.HermesEventDequeued;
      data = await probeQueue();
    } else if (target === 'hermes-worker') {
      hop = DiagnosticHop.HermesWorker;
      successType = DiagnosticEventType.HermesWorkerSeen;
      data = await probeWorker();
    } else {
      return json(
        {
          success: false,
          error_code: 'DIAGNOSTICS_UNKNOWN_PROBE',
          error_message: 'Unknown diagnostics probe target.'
        },
        { status: 404 }
      );
    }

    const roundTripMs = Date.now() - startedAt;
    emitDiagnosticEvent(successType, hop, { target, roundTripMs, status: 'success' });
    return json({ success: true, target, roundTripMs, data });
  } catch (error) {
    const roundTripMs = Date.now() - startedAt;
    const hop = target === 'storage' ? DiagnosticHop.ObjectStorage : target === 'database' ? DiagnosticHop.Database : DiagnosticHop.WebuiApi;
    const eventType = target === 'storage' ? DiagnosticEventType.StorageProbeFailed : DiagnosticEventType.DatabaseProbeFailed;
    emitDiagnosticEvent(eventType, hop, { target, roundTripMs, status: 'failed', ...errorDetails(error) });
    return json(
      {
        success: false,
        target,
        roundTripMs,
        error_code: 'DIAGNOSTICS_PROBE_FAILED',
        error_message: error instanceof Error ? error.message : 'Probe failed.'
      },
      { status: 500 }
    );
  }
}