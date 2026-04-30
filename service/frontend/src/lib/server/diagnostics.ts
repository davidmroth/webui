import { getConfig } from './env';

export const DiagnosticHop = {
  BrowserClient: 'browser_client',
  SseStream: 'sse_stream',
  WebuiApi: 'webui_api',
  HermesWorker: 'hermes_worker',
  HermesQueue: 'hermes_queue',
  ObjectStorage: 'object_storage',
  Database: 'database'
} as const;

export const DiagnosticEventType = {
  ClientMessageQueued: 'CLIENT_MESSAGE_QUEUED',
  ClientMessageRejected: 'CLIENT_MESSAGE_REJECTED',
  SseClientConnected: 'SSE_CLIENT_CONNECTED',
  SseClientDisconnected: 'SSE_CLIENT_DISCONNECTED',
  SseEventSent: 'SSE_EVENT_SENT',
  HermesWorkerSeen: 'HERMES_WORKER_SEEN',
  HermesAuthFailed: 'HERMES_AUTH_FAILED',
  HermesEventDequeued: 'HERMES_EVENT_DEQUEUED',
  HermesEventAcked: 'HERMES_EVENT_ACKED',
  HermesAssistantPostReceived: 'HERMES_ASSISTANT_POST_RECEIVED',
  HermesAssistantPostAccepted: 'HERMES_ASSISTANT_POST_ACCEPTED',
  HermesAssistantPostRejected: 'HERMES_ASSISTANT_POST_REJECTED',
  HermesAssistantPostFailed: 'HERMES_ASSISTANT_POST_FAILED',
  HermesAssistantUpdateStarted: 'HERMES_ASSISTANT_UPDATE_STARTED',
  HermesAssistantUpdateRejected: 'HERMES_ASSISTANT_UPDATE_REJECTED',
  HermesAssistantUpdateFailed: 'HERMES_ASSISTANT_UPDATE_FAILED',
  HermesStreamingMessageOpened: 'HERMES_STREAMING_MESSAGE_OPENED',
  HermesStreamingDeltaReceived: 'HERMES_STREAMING_DELTA_RECEIVED',
  HermesStreamingMessageFinalized: 'HERMES_STREAMING_MESSAGE_FINALIZED',
  HermesGatewayStatusReceived: 'HERMES_GATEWAY_STATUS_RECEIVED',
  AttachmentUploadSucceeded: 'ATTACHMENT_UPLOAD_SUCCEEDED',
  AttachmentUploadFailed: 'ATTACHMENT_UPLOAD_FAILED',
  AttachmentDownloadSucceeded: 'ATTACHMENT_DOWNLOAD_SUCCEEDED',
  AttachmentDownloadFailed: 'ATTACHMENT_DOWNLOAD_FAILED',
  StorageProbeSucceeded: 'STORAGE_PROBE_SUCCEEDED',
  StorageProbeFailed: 'STORAGE_PROBE_FAILED',
  DatabaseProbeSucceeded: 'DATABASE_PROBE_SUCCEEDED',
  DatabaseProbeFailed: 'DATABASE_PROBE_FAILED',
  DiagnosticChatProbeRequested: 'DIAGNOSTIC_CHAT_PROBE_REQUESTED',
  DiagnosticChatProbeQueued: 'DIAGNOSTIC_CHAT_PROBE_QUEUED',
  DiagnosticChatProbeCompleted: 'DIAGNOSTIC_CHAT_PROBE_COMPLETED',
  DiagnosticChatProbeFailed: 'DIAGNOSTIC_CHAT_PROBE_FAILED',
  WorkerStatusStale: 'WORKER_STATUS_STALE',
  WorkerStatusRecovered: 'WORKER_STATUS_RECOVERED'
} as const;

export type DiagnosticHopValue = (typeof DiagnosticHop)[keyof typeof DiagnosticHop];
export type DiagnosticEventTypeValue = (typeof DiagnosticEventType)[keyof typeof DiagnosticEventType];

type DiagnosticDetails = Record<string, unknown>;

export interface DiagnosticEvent {
  id: string;
  timestamp: string;
  eventType: DiagnosticEventTypeValue;
  hop: DiagnosticHopValue;
  details: DiagnosticDetails;
  entityId: string | null;
  conversationId: string | null;
  messageId: string | null;
  requestId: string | null;
  senderTraceId: string | null;
}

interface HopSnapshot {
  hop: DiagnosticHopValue;
  connected: boolean;
  healthy: boolean;
  reconnectCount: number;
  errorCount: number;
  eventCounts: Record<string, number>;
  lastError: string | null;
  lastErrorAt: string | null;
  lastActivityAt: string | null;
  connectedSince: number | null;
  activeConnections?: number;
  connectionEntityIds?: string[];
}

interface EntitySnapshot {
  entityId: string;
  lastStatusAt: string | null;
  statusCount: number;
  registrationCount: number;
  stale: boolean;
  metadata: DiagnosticDetails;
}

interface PendingEventSnapshot {
  eventId: string;
  messageId: string | null;
  conversationId: string | null;
  queuedAt: string;
  status: 'queued' | 'processing';
}

export interface DiagnosticEventFilters {
  limit?: number;
  eventType?: string | null;
  hop?: string | null;
  entityId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  requestId?: string | null;
  senderTraceId?: string | null;
}

const DEFAULT_RING_BUFFER_SIZE = 1000;
const MIN_RING_BUFFER_SIZE = 100;
const MAX_RING_BUFFER_SIZE = 5000;

const events: DiagnosticEvent[] = [];
const hops = new Map<DiagnosticHopValue, HopSnapshot>();
const entities = new Map<string, EntitySnapshot>();
const pendingEvents = new Map<string, PendingEventSnapshot>();
const sseConnections = new Set<string>();
const bootTimeMs = Date.now();

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function getRingBufferSize() {
  return clamp(
    getConfig().diagnosticsRingBufferSize ?? DEFAULT_RING_BUFFER_SIZE,
    MIN_RING_BUFFER_SIZE,
    MAX_RING_BUFFER_SIZE
  );
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getErrorText(details: DiagnosticDetails) {
  return (
    asString(details.errorMessage) ??
    asString(details.error) ??
    asString(details.reason) ??
    asString(details.errorCode) ??
    null
  );
}

function isFailureEvent(eventType: DiagnosticEventTypeValue) {
  return eventType.endsWith('_FAILED') || eventType.endsWith('_REJECTED') || eventType === DiagnosticEventType.HermesAuthFailed;
}

function ensureHop(hop: DiagnosticHopValue): HopSnapshot {
  const existing = hops.get(hop);
  if (existing) {
    return existing;
  }

  const snapshot: HopSnapshot = {
    hop,
    connected: false,
    healthy: true,
    reconnectCount: 0,
    errorCount: 0,
    eventCounts: {},
    lastError: null,
    lastErrorAt: null,
    lastActivityAt: null,
    connectedSince: null
  };
  hops.set(hop, snapshot);
  return snapshot;
}

function ensureEntity(entityId: string): EntitySnapshot {
  const existing = entities.get(entityId);
  if (existing) {
    return existing;
  }

  const snapshot: EntitySnapshot = {
    entityId,
    lastStatusAt: null,
    statusCount: 0,
    registrationCount: 0,
    stale: false,
    metadata: {}
  };
  entities.set(entityId, snapshot);
  return snapshot;
}

function updateHop(event: DiagnosticEvent, eventTimeMs: number) {
  const hop = ensureHop(event.hop);
  hop.lastActivityAt = event.timestamp;
  hop.eventCounts[event.eventType] = (hop.eventCounts[event.eventType] ?? 0) + 1;

  if (event.eventType === DiagnosticEventType.SseClientConnected) {
    const connectionId = asString(event.details.connectionId) ?? event.id;
    sseConnections.add(connectionId);
    hop.connected = true;
    hop.healthy = true;
    hop.connectedSince ??= eventTimeMs;
    hop.activeConnections = sseConnections.size;
    hop.connectionEntityIds = [...new Set([...sseConnections].slice(-200))];
  }

  if (event.eventType === DiagnosticEventType.SseClientDisconnected) {
    const connectionId = asString(event.details.connectionId);
    if (connectionId) {
      sseConnections.delete(connectionId);
    }
    hop.activeConnections = sseConnections.size;
    hop.connected = sseConnections.size > 0;
    if (!hop.connected) {
      hop.connectedSince = null;
    }
  }

  if (
    event.eventType === DiagnosticEventType.HermesWorkerSeen ||
    event.eventType === DiagnosticEventType.WorkerStatusRecovered ||
    event.eventType.endsWith('_SUCCEEDED')
  ) {
    hop.connected = true;
    hop.healthy = true;
    hop.connectedSince ??= eventTimeMs;
  }

  if (isFailureEvent(event.eventType) || event.eventType.endsWith('_FAILED')) {
    hop.healthy = false;
    hop.errorCount += 1;
    hop.lastError = getErrorText(event.details);
    hop.lastErrorAt = event.timestamp;
  }

  if (event.eventType === DiagnosticEventType.WorkerStatusStale) {
    hop.connected = false;
    hop.healthy = false;
    hop.lastError = 'Hermes worker heartbeat is stale.';
    hop.lastErrorAt = event.timestamp;
  }

  if (event.eventType === DiagnosticEventType.HermesGatewayStatusReceived) {
    const failed = asString(event.details.status) === 'failed' || Boolean(event.details.errorCode);
    if (failed) {
      hop.healthy = false;
      hop.errorCount += 1;
      hop.lastError = getErrorText(event.details);
      hop.lastErrorAt = event.timestamp;
    }
  }
}

function updateEntity(event: DiagnosticEvent) {
  const entityId = event.entityId ?? event.conversationId ?? event.messageId;
  if (!entityId) {
    return;
  }

  const entity = ensureEntity(entityId);
  entity.lastStatusAt = event.timestamp;
  entity.statusCount += 1;
  entity.stale = false;
  entity.metadata = {
    ...entity.metadata,
    lastEventType: event.eventType,
    hop: event.hop,
    conversationId: event.conversationId,
    messageId: event.messageId,
    requestId: event.requestId,
    senderTraceId: event.senderTraceId,
    status: event.details.status ?? entity.metadata.status ?? null
  };

  if (event.eventType === DiagnosticEventType.ClientMessageQueued) {
    entity.registrationCount += 1;
  }

  if (isFailureEvent(event.eventType)) {
    entity.metadata = {
      ...entity.metadata,
      lastError: getErrorText(event.details),
      lastErrorAt: event.timestamp
    };
  }
}

function updatePendingEvents(event: DiagnosticEvent) {
  const eventId = asString(event.details.eventId);
  if (!eventId) {
    return;
  }

  if (event.eventType === DiagnosticEventType.ClientMessageQueued) {
    pendingEvents.set(eventId, {
      eventId,
      messageId: event.messageId,
      conversationId: event.conversationId,
      queuedAt: event.timestamp,
      status: 'queued'
    });
  }

  if (event.eventType === DiagnosticEventType.HermesEventDequeued) {
    const existing = pendingEvents.get(eventId);
    pendingEvents.set(eventId, {
      eventId,
      messageId: event.messageId ?? existing?.messageId ?? null,
      conversationId: event.conversationId ?? existing?.conversationId ?? null,
      queuedAt: existing?.queuedAt ?? event.timestamp,
      status: 'processing'
    });
  }

  if (event.eventType === DiagnosticEventType.HermesEventAcked) {
    pendingEvents.delete(eventId);
  }
}

function summarizeRecentEvents(nowMs: number) {
  const fiveMinutesAgo = nowMs - 5 * 60_000;
  const summary: Record<string, number> = {};
  for (const event of events) {
    if (Date.parse(event.timestamp) < fiveMinutesAgo) {
      continue;
    }
    summary[event.eventType] = (summary[event.eventType] ?? 0) + 1;
  }
  return { last5Minutes: summary };
}

function serializeHop(hop: HopSnapshot) {
  const uptimeSeconds = hop.connectedSince ? Math.max(0, (Date.now() - hop.connectedSince) / 1000) : null;
  return {
    ...hop,
    uptimeSeconds,
    connectionEntityIds: hop.connectionEntityIds ?? []
  };
}

function serializeEntity(entity: EntitySnapshot) {
  const statusAgeSeconds = entity.lastStatusAt
    ? Math.max(0, (Date.now() - Date.parse(entity.lastStatusAt)) / 1000)
    : null;
  return {
    ...entity,
    statusAgeSeconds
  };
}

function pendingCommandsSnapshot() {
  const now = Date.now();
  const pending = [...pendingEvents.values()];
  const oldestPendingAgeSeconds = pending.length
    ? Math.max(...pending.map((entry) => Math.max(0, (now - Date.parse(entry.queuedAt)) / 1000)))
    : null;
  return {
    pendingCount: pending.length,
    oldestPendingAgeSeconds,
    pending: pending.slice(-50)
  };
}

export function emitDiagnosticEvent(
  eventType: DiagnosticEventTypeValue,
  hop: DiagnosticHopValue,
  details: DiagnosticDetails = {},
  entityId?: string | null
) {
  try {
    const nowMs = Date.now();
    const event: DiagnosticEvent = {
      id: newId(),
      timestamp: new Date(nowMs).toISOString(),
      eventType,
      hop,
      details,
      entityId: entityId ?? asString(details.entityId),
      conversationId: asString(details.conversationId),
      messageId: asString(details.messageId),
      requestId: asString(details.requestId),
      senderTraceId: asString(details.senderTraceId)
    };

    events.push(event);
    const maxEvents = getRingBufferSize();
    while (events.length > maxEvents) {
      events.shift();
    }

    updateHop(event, nowMs);
    updateEntity(event);
    updatePendingEvents(event);
  } catch {
    // Diagnostics must never interrupt application flow.
  }
}

export function getDiagnosticEvents(filters: DiagnosticEventFilters = {}) {
  const limit = clamp(filters.limit ?? 50, 1, 200);
  return events
    .filter((event) => !filters.eventType || event.eventType === filters.eventType)
    .filter((event) => !filters.hop || event.hop === filters.hop)
    .filter((event) => !filters.entityId || event.entityId === filters.entityId)
    .filter((event) => !filters.conversationId || event.conversationId === filters.conversationId)
    .filter((event) => !filters.messageId || event.messageId === filters.messageId)
    .filter((event) => !filters.requestId || event.requestId === filters.requestId)
    .filter((event) => !filters.senderTraceId || event.senderTraceId === filters.senderTraceId)
    .slice()
    .reverse()
    .slice(0, limit);
}

export function getDiagnosticsSnapshot() {
  const nowMs = Date.now();
  const memoryUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();
  return {
    timestamp: new Date(nowMs).toISOString(),
    hops: Object.fromEntries([...hops.entries()].map(([name, hop]) => [name, serializeHop(hop)])),
    entities: Object.fromEntries([...entities.entries()].map(([id, entity]) => [id, serializeEntity(entity)])),
    commands: pendingCommandsSnapshot(),
    system: {
      uptimeSeconds: Math.max(0, (nowMs - bootTimeMs) / 1000),
      memoryUsageMb: Math.round((memoryUsage.rss / 1024 / 1024) * 100) / 100,
      heapUsedMb: Math.round((memoryUsage.heapUsed / 1024 / 1024) * 100) / 100,
      cpuTimeSeconds: Math.round(((cpuUsage.user + cpuUsage.system) / 1_000_000) * 100) / 100,
      pid: process.pid,
      nodeVersion: process.version
    },
    ringBuffer: {
      size: events.length,
      capacity: getRingBufferSize()
    },
    recentEventsSummary: summarizeRecentEvents(nowMs)
  };
}

export function getDiagnosticEntity(entityId: string) {
  const entity = entities.get(entityId) ?? null;
  return {
    entity: entity ? serializeEntity(entity) : null,
    events: getDiagnosticEvents({ entityId, limit: 20 })
  };
}

export function resetDiagnosticsForTests() {
  events.length = 0;
  hops.clear();
  entities.clear();
  pendingEvents.clear();
  sseConnections.clear();
}