import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { createStorageClient } from './storage';
import { getHermesQueueStats } from './chat';
import { getConfig } from './env';
import { query } from './db';
import { getHermesWorkerHeartbeat } from './hermes-heartbeat';
import type { RequestEvent } from '@sveltejs/kit';

interface BuildInfo {
  source: 'version.json' | '.build.json' | 'package.json';
  metadataMode: 'image-baked' | 'package-fallback';
  frontend: string;
  gitTag: string | null;
  gitCommit: string | null;
  gitCommitShort: string | null;
  gitBranch: string | null;
  buildTime: string | null;
}

interface AttachmentStats {
  totalCount: number;
  assistantCount: number;
  userCount: number;
  lastAttachmentAt: string | null;
  lastAssistantAttachmentAt: string | null;
  assistantAttachmentSignal: 'absent' | 'rare' | 'present';
}

interface DatabaseTelemetry {
  ok: boolean;
  version: string | null;
  serverTime: string | null;
  counts: {
    users: number;
    conversations: number;
    messages: number;
    attachments: number;
    activeSessions: number;
  } | null;
  attachmentStats: AttachmentStats;
  latestConversationUpdate: string | null;
  latestMessageCreated: string | null;
  error: string | null;
}

interface AttachmentTelemetryRow {
  total_attachments: number | string | null;
  assistant_attachments: number | string | null;
  user_attachments: number | string | null;
  last_attachment_time: Date | string | null;
  last_assistant_attachment_time: Date | string | null;
}

interface FileDeliveryChecks {
  databaseOk: boolean;
  storageOk: boolean;
  bucketExists: boolean;
  hermesServiceTokenConfigured: boolean;
  queueNotStuck: boolean;
  workerHeartbeatFresh: boolean;
  workerAuthFailureRecent: boolean;
  queuedWithoutWorker: boolean;
  recentSenderTraceSeen: boolean;
  recentSenderTraceWithAttachment: boolean;
}

interface FileDeliveryDiagnosis {
  code: string;
  verdict: string;
  summary: string;
  receiverHealthy: boolean;
  queueNotStuck: boolean;
  senderConfigVerified: false;
  verificationScope: 'receiver-only';
  checks: FileDeliveryChecks;
}

interface HermesDeliveryTraceRow {
  sender_trace_id: string | null;
  conversation_id: string;
  receiver_message_id: string | null;
  route: string;
  sender_base_url: string | null;
  sender_target_url: string | null;
  sender_hostname: string | null;
  sender_session_platform: string | null;
  sender_session_chat_id: string | null;
  attachment_count: number | string;
  attachment_names: string | string[] | null;
  content_length: number | string;
  receiver_status: 'accepted' | 'rejected';
  error_text: string | null;
  created_at: Date | string;
}

interface HermesDeliveryTraceStatsRow {
  total_count: number | string | null;
  accepted_count: number | string | null;
  rejected_count: number | string | null;
  with_attachments_count: number | string | null;
  last_received_at: Date | string | null;
}

interface RecentAssistantMessageRow {
  id: string;
  conversation_id: string;
  created_at: Date | string;
  content: string | null;
  timings: string | object | null;
}

interface RecentAssistantMessage {
  id: string;
  conversationId: string;
  createdAt: string | null;
  contentSnippet: string;
  contentLength: number;
  timings: Record<string, unknown> | null;
  timingsRaw: string | null;
}

interface RecentAssistantTimingsTelemetry {
  ok: boolean;
  totalAssistantCount: number;
  withTimingsCount: number;
  withoutTimingsCount: number;
  lastWithTimingsAt: string | null;
  recent: RecentAssistantMessage[];
  error: string | null;
}

interface HermesDeliveryTraceSample {
  createdAt: string;
  senderTraceId: string | null;
  conversationId: string;
  receiverMessageId: string | null;
  route: string;
  senderBaseUrl: string | null;
  senderTargetUrl: string | null;
  senderHostname: string | null;
  senderSessionPlatform: string | null;
  senderSessionChatId: string | null;
  attachmentCount: number;
  attachmentNames: string[];
  contentLength: number;
  receiverStatus: 'accepted' | 'rejected';
  errorText: string | null;
}

interface HermesDeliveryTraceTelemetry {
  ok: boolean;
  totalCount: number;
  acceptedCount: number;
  rejectedCount: number;
  withAttachmentsCount: number;
  lastReceivedAt: string | null;
  recent: HermesDeliveryTraceSample[];
  error: string | null;
}

interface CountRow {
  count: number | string;
}

interface DatabaseMetaRow {
  server_time: Date | string;
  version: string;
}

interface TimestampRow {
  value: Date | string | null;
}

function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function safeSecretEqual(expected: string, received: string): boolean {
  const expectedHash = Buffer.from(hashValue(expected), 'hex');
  const receivedHash = Buffer.from(hashValue(received), 'hex');
  return timingSafeEqual(expectedHash, receivedHash);
}

function parseBearerToken(headerValue: string | null): string {
  if (!headerValue) {
    return '';
  }
  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? '';
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function parseAttachmentNames(value: string | string[] | null | undefined): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  }

  if (typeof value !== 'string' || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function setMaintenanceCookie(event: RequestEvent) {
  const config = getConfig();
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 12);
  event.cookies.set(config.maintenanceCookieName, hashValue(config.maintenanceToken), {
    httpOnly: true,
    sameSite: 'strict',
    secure: event.url.protocol === 'https:',
    path: '/maintenance',
    expires
  });
}

export function clearMaintenanceCookie(event: RequestEvent) {
  const config = getConfig();
  event.cookies.delete(config.maintenanceCookieName, { path: '/maintenance' });
}

export function isMaintenanceEnabled(): boolean {
  return getConfig().maintenanceToken.trim().length > 0;
}

export function validateMaintenanceToken(candidate: string): boolean {
  const expected = getConfig().maintenanceToken.trim();
  if (!expected || !candidate) {
    return false;
  }
  return safeSecretEqual(expected, candidate.trim());
}

export function authorizeMaintenance(event: RequestEvent, candidate: string): boolean {
  if (!validateMaintenanceToken(candidate)) {
    return false;
  }
  setMaintenanceCookie(event);
  return true;
}

export function hasMaintenanceAccess(event: RequestEvent): boolean {
  const config = getConfig();
  const expected = config.maintenanceToken.trim();
  if (!expected) {
    return false;
  }

  const cookieValue = event.cookies.get(config.maintenanceCookieName) ?? '';
  if (cookieValue && safeSecretEqual(hashValue(expected), cookieValue)) {
    return true;
  }

  const queryToken = event.url.searchParams.get('token')?.trim() ?? '';
  if (queryToken && validateMaintenanceToken(queryToken)) {
    return true;
  }

  const bearerToken = parseBearerToken(event.request.headers.get('authorization'));
  return bearerToken ? validateMaintenanceToken(bearerToken) : false;
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function resolveBuildVersion(build: { frontend?: unknown; gitTag?: unknown } | null): string {
  const gitTag = build?.gitTag ? String(build.gitTag).trim() : '';
  if (gitTag && gitTag !== 'no-tag') {
    return gitTag;
  }

  const frontend = build?.frontend ? String(build.frontend).trim() : '';
  return frontend || '0.0.0';
}

export async function getBuildInfo(): Promise<BuildInfo> {
  const cwd = process.cwd();
  const versionJson = await readJsonFile<Partial<BuildInfo>>(
    resolve(cwd, 'version.json')
  );
  if (versionJson) {
    return {
      source: 'version.json',
      metadataMode: 'image-baked',
      frontend: resolveBuildVersion(versionJson),
      gitTag: versionJson.gitTag ? String(versionJson.gitTag) : null,
      gitCommit: versionJson.gitCommit ? String(versionJson.gitCommit) : null,
      gitCommitShort: versionJson.gitCommitShort ? String(versionJson.gitCommitShort) : null,
      gitBranch: versionJson.gitBranch ? String(versionJson.gitBranch) : null,
      buildTime: versionJson.buildTime ? String(versionJson.buildTime) : null
    };
  }

  const buildJson = await readJsonFile<Partial<BuildInfo>>(
    resolve(cwd, '.build.json')
  );
  if (buildJson) {
    return {
      source: '.build.json',
      metadataMode: 'image-baked',
      frontend: resolveBuildVersion(buildJson),
      gitTag: buildJson.gitTag ? String(buildJson.gitTag) : null,
      gitCommit: buildJson.gitCommit ? String(buildJson.gitCommit) : null,
      gitCommitShort: buildJson.gitCommitShort ? String(buildJson.gitCommitShort) : null,
      gitBranch: buildJson.gitBranch ? String(buildJson.gitBranch) : null,
      buildTime: buildJson.buildTime ? String(buildJson.buildTime) : null
    };
  }

  const packageJson = await readJsonFile<{ version?: string }>(resolve(cwd, 'package.json'));
  return {
    source: 'package.json',
    metadataMode: 'package-fallback',
    frontend: String(packageJson?.version ?? '0.0.0'),
    gitTag: null,
    gitCommit: null,
    gitCommitShort: null,
    gitBranch: null,
    buildTime: null
  };
}

function deriveAssistantAttachmentSignal(totalCount: number, assistantCount: number): AttachmentStats['assistantAttachmentSignal'] {
  if (assistantCount === 0) {
    return 'absent';
  }
  if (totalCount >= 5 && assistantCount / Math.max(totalCount, 1) < 0.2) {
    return 'rare';
  }
  return 'present';
}

async function getDatabaseTelemetry(): Promise<DatabaseTelemetry> {
  try {
    const [metaRow] = await query<DatabaseMetaRow>(
      'SELECT UTC_TIMESTAMP() AS server_time, VERSION() AS version'
    );
    const [users, conversations, messages, attachments, sessions] = await Promise.all([
      query<CountRow>('SELECT COUNT(*) AS count FROM users'),
      query<CountRow>('SELECT COUNT(*) AS count FROM conversations'),
      query<CountRow>('SELECT COUNT(*) AS count FROM messages'),
      query<CountRow>('SELECT COUNT(*) AS count FROM attachments'),
      query<CountRow>('SELECT COUNT(*) AS count FROM web_sessions')
    ]);
    const [latestConversationUpdate, latestMessageCreated] = await Promise.all([
      query<TimestampRow>('SELECT MAX(updated_at) AS value FROM conversations'),
      query<TimestampRow>('SELECT MAX(created_at) AS value FROM messages')
    ]);
    const [attachmentTelemetry] = await query<AttachmentTelemetryRow>(
      `SELECT
         COUNT(DISTINCT a.id) AS total_attachments,
         COALESCE(SUM(CASE WHEN m.role = 'assistant' THEN 1 ELSE 0 END), 0) AS assistant_attachments,
         COALESCE(SUM(CASE WHEN m.role = 'user' THEN 1 ELSE 0 END), 0) AS user_attachments,
         MAX(a.created_at) AS last_attachment_time,
         MAX(CASE WHEN m.role = 'assistant' THEN a.created_at END) AS last_assistant_attachment_time
       FROM attachments a
       LEFT JOIN messages m ON a.message_id = m.id`
    );

    const totalAttachmentCount = Number(attachmentTelemetry?.total_attachments ?? 0);
    const assistantAttachmentCount = Number(attachmentTelemetry?.assistant_attachments ?? 0);
    const userAttachmentCount = Number(attachmentTelemetry?.user_attachments ?? 0);

    return {
      ok: true,
      version: metaRow?.version ?? 'unknown',
      serverTime: toIsoString(metaRow?.server_time),
      counts: {
        users: Number(users[0]?.count ?? 0),
        conversations: Number(conversations[0]?.count ?? 0),
        messages: Number(messages[0]?.count ?? 0),
        attachments: Number(attachments[0]?.count ?? 0),
        activeSessions: Number(sessions[0]?.count ?? 0)
      },
      attachmentStats: {
        totalCount: totalAttachmentCount,
        assistantCount: assistantAttachmentCount,
        userCount: userAttachmentCount,
        lastAttachmentAt: toIsoString(attachmentTelemetry?.last_attachment_time),
        lastAssistantAttachmentAt: toIsoString(attachmentTelemetry?.last_assistant_attachment_time),
        assistantAttachmentSignal: deriveAssistantAttachmentSignal(totalAttachmentCount, assistantAttachmentCount)
      },
      latestConversationUpdate: toIsoString(latestConversationUpdate[0]?.value),
      latestMessageCreated: toIsoString(latestMessageCreated[0]?.value),
      error: null
    };
  } catch (error) {
    return {
      ok: false,
      version: null,
      serverTime: null,
      counts: null,
      attachmentStats: {
        totalCount: 0,
        assistantCount: 0,
        userCount: 0,
        lastAttachmentAt: null,
        lastAssistantAttachmentAt: null,
        assistantAttachmentSignal: 'absent'
      },
      latestConversationUpdate: null,
      latestMessageCreated: null,
      error: error instanceof Error ? error.message : 'Database query failed.'
    };
  }
}

async function getStorageTelemetry() {
  const config = getConfig();
  try {
    const client = createStorageClient();
    const bucketExists = await client.bucketExists(config.objectStorageBucket);
    return {
      ok: true,
      endpoint: config.objectStorageEndpoint,
      port: config.objectStoragePort,
      useSsl: config.objectStorageUseSsl,
      bucket: config.objectStorageBucket,
      bucketExists,
      error: null
    };
  } catch (error) {
    return {
      ok: false,
      endpoint: config.objectStorageEndpoint,
      port: config.objectStoragePort,
      useSsl: config.objectStorageUseSsl,
      bucket: config.objectStorageBucket,
      bucketExists: false,
      error: error instanceof Error ? error.message : 'Storage probe failed.'
    };
  }
}

function parseTimingsValue(raw: string | object | null | undefined): {
  parsed: Record<string, unknown> | null;
  rawText: string | null;
} {
  if (raw === null || raw === undefined) {
    return { parsed: null, rawText: null };
  }
  if (typeof raw === 'string') {
    const text = raw;
    try {
      const parsed = JSON.parse(text);
      return {
        parsed: parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null,
        rawText: text
      };
    } catch {
      return { parsed: null, rawText: text };
    }
  }
  if (typeof raw === 'object') {
    return {
      parsed: raw as Record<string, unknown>,
      rawText: JSON.stringify(raw)
    };
  }
  return { parsed: null, rawText: null };
}

async function getRecentAssistantTimingsTelemetry(): Promise<RecentAssistantTimingsTelemetry> {
  try {
    const [statsRow] = await query<{
      total_count: number | string | null;
      with_timings_count: number | string | null;
      last_with_timings_at: Date | string | null;
    }>(
      `SELECT
         COUNT(*) AS total_count,
         SUM(CASE WHEN timings IS NOT NULL THEN 1 ELSE 0 END) AS with_timings_count,
         MAX(CASE WHEN timings IS NOT NULL THEN created_at END) AS last_with_timings_at
       FROM messages
       WHERE role = 'assistant'`
    );
    const rows = await query<RecentAssistantMessageRow>(
      `SELECT id, conversation_id, created_at, content, timings
       FROM messages
       WHERE role = 'assistant'
       ORDER BY created_at DESC
       LIMIT 10`
    );
    const total = Number(statsRow?.total_count ?? 0);
    const withTimings = Number(statsRow?.with_timings_count ?? 0);
    return {
      ok: true,
      totalAssistantCount: total,
      withTimingsCount: withTimings,
      withoutTimingsCount: Math.max(total - withTimings, 0),
      lastWithTimingsAt: toIsoString(statsRow?.last_with_timings_at),
      recent: rows.map((row) => {
        const { parsed, rawText } = parseTimingsValue(row.timings);
        const content = row.content ?? '';
        return {
          id: row.id,
          conversationId: row.conversation_id,
          createdAt: toIsoString(row.created_at),
          contentSnippet: content.slice(0, 80),
          contentLength: content.length,
          timings: parsed,
          timingsRaw: rawText
        };
      }),
      error: null
    };
  } catch (error) {
    return {
      ok: false,
      totalAssistantCount: 0,
      withTimingsCount: 0,
      withoutTimingsCount: 0,
      lastWithTimingsAt: null,
      recent: [],
      error: error instanceof Error ? error.message : 'Recent assistant timings query failed.'
    };
  }
}

async function getHermesDeliveryTraceTelemetry(): Promise<HermesDeliveryTraceTelemetry> {
  try {
    const [statsRow] = await query<HermesDeliveryTraceStatsRow>(
      `SELECT
         COUNT(*) AS total_count,
         COALESCE(SUM(CASE WHEN receiver_status = 'accepted' THEN 1 ELSE 0 END), 0) AS accepted_count,
         COALESCE(SUM(CASE WHEN receiver_status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected_count,
         COALESCE(SUM(CASE WHEN attachment_count > 0 THEN 1 ELSE 0 END), 0) AS with_attachments_count,
         MAX(created_at) AS last_received_at
       FROM hermes_delivery_traces`
    );
    const recentRows = await query<HermesDeliveryTraceRow>(
      `SELECT
         sender_trace_id,
         conversation_id,
         receiver_message_id,
         route,
         sender_base_url,
         sender_target_url,
         sender_hostname,
         sender_session_platform,
         sender_session_chat_id,
         attachment_count,
         attachment_names,
         content_length,
         receiver_status,
         error_text,
         created_at
       FROM hermes_delivery_traces
       ORDER BY created_at DESC
       LIMIT 8`
    );

    return {
      ok: true,
      totalCount: Number(statsRow?.total_count ?? 0),
      acceptedCount: Number(statsRow?.accepted_count ?? 0),
      rejectedCount: Number(statsRow?.rejected_count ?? 0),
      withAttachmentsCount: Number(statsRow?.with_attachments_count ?? 0),
      lastReceivedAt: toIsoString(statsRow?.last_received_at),
      recent: recentRows.map((row) => ({
        createdAt: toIsoString(row.created_at) ?? new Date(0).toISOString(),
        senderTraceId: row.sender_trace_id,
        conversationId: row.conversation_id,
        receiverMessageId: row.receiver_message_id,
        route: row.route,
        senderBaseUrl: row.sender_base_url,
        senderTargetUrl: row.sender_target_url,
        senderHostname: row.sender_hostname,
        senderSessionPlatform: row.sender_session_platform,
        senderSessionChatId: row.sender_session_chat_id,
        attachmentCount: Number(row.attachment_count ?? 0),
        attachmentNames: parseAttachmentNames(row.attachment_names),
        contentLength: Number(row.content_length ?? 0),
        receiverStatus: row.receiver_status,
        errorText: row.error_text
      })),
      error: null
    };
  } catch (error) {
    return {
      ok: false,
      totalCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      withAttachmentsCount: 0,
      lastReceivedAt: null,
      recent: [],
      error: error instanceof Error ? error.message : 'Delivery trace query failed.'
    };
  }
}

function deriveFileDeliveryDiagnosis(params: {
  database: DatabaseTelemetry;
  storage: Awaited<ReturnType<typeof getStorageTelemetry>>;
  deliveryTraces: HermesDeliveryTraceTelemetry;
  queue: Awaited<ReturnType<typeof getHermesQueueStats>> & { error?: string };
  workerHeartbeat: ReturnType<typeof getHermesWorkerHeartbeat>;
  hermesServiceTokenConfigured: boolean;
}): FileDeliveryDiagnosis {
  const { database, storage, deliveryTraces, queue, workerHeartbeat, hermesServiceTokenConfigured } = params;
  const queueNotStuck = !queue.error && Number(queue.staleProcessing ?? 0) === 0;
  const workerHeartbeatFresh = workerHeartbeat.isOnline;
  const workerAuthFailureRecent =
    Boolean(workerHeartbeat.authFailure?.seen) &&
    typeof workerHeartbeat.authFailure?.ageSeconds === 'number' &&
    workerHeartbeat.authFailure.ageSeconds <= 600;
  const queuedWithoutWorker = Number(queue.queued ?? 0) > 0 && !workerHeartbeatFresh;
  const receiverHealthy = database.ok && storage.ok && storage.bucketExists;
  const recentSenderTraceSeen = deliveryTraces.totalCount > 0;
  const recentSenderTraceWithAttachment = deliveryTraces.withAttachmentsCount > 0;
  const checks: FileDeliveryChecks = {
    databaseOk: database.ok,
    storageOk: storage.ok,
    bucketExists: storage.bucketExists,
    hermesServiceTokenConfigured,
    queueNotStuck,
    workerHeartbeatFresh,
    workerAuthFailureRecent,
    queuedWithoutWorker,
    recentSenderTraceSeen,
    recentSenderTraceWithAttachment
  };

  if (!database.ok || !storage.ok || !storage.bucketExists) {
    return {
      code: 'receiver-unhealthy',
      verdict: 'Receiver issue detected',
      summary: 'WebUI receiver checks failed in database or object storage, so attachment delivery can fail before sender diagnosis is meaningful.',
      receiverHealthy,
      queueNotStuck,
      senderConfigVerified: false,
      verificationScope: 'receiver-only',
      checks
    };
  }

  if (!hermesServiceTokenConfigured) {
    return {
      code: 'receiver-auth-misconfigured',
      verdict: 'Receiver auth not configured',
      summary: 'The webui Hermes service token is not configured, so assistant attachment posts cannot be authenticated.',
      receiverHealthy,
      queueNotStuck,
      senderConfigVerified: false,
      verificationScope: 'receiver-only',
      checks
    };
  }

  if (!queueNotStuck) {
    return {
      code: 'receiver-queue-stalled',
      verdict: 'Receiver queue appears stuck',
      summary: 'The receiver queue shows stale processing work, so a backend delivery problem may still exist inside the webui receiver path.',
      receiverHealthy,
      queueNotStuck,
      senderConfigVerified: false,
      verificationScope: 'receiver-only',
      checks
    };
  }

  if (queuedWithoutWorker) {
    if (workerAuthFailureRecent) {
      return {
        code: 'worker-auth-failed',
        verdict: 'Hermes worker auth failed recently',
        summary:
          'Queued work exists and the receiver recently saw unauthorized Hermes worker requests. This usually means WEBCHAT_SERVICE_TOKEN and HERMES_WEBCHAT_SERVICE_TOKEN do not match.',
        receiverHealthy,
        queueNotStuck,
        senderConfigVerified: false,
        verificationScope: 'receiver-only',
        checks
      };
    }

    return {
      code: 'worker-heartbeat-stale',
      verdict: 'Hermes worker heartbeat is stale',
      summary:
        'Queued work exists, but no recent worker heartbeat has been observed. Conversation status may remain stalled until the Hermes webchat poller reconnects.',
      receiverHealthy,
      queueNotStuck,
      senderConfigVerified: false,
      verificationScope: 'receiver-only',
      checks
    };
  }

  if (recentSenderTraceSeen && !recentSenderTraceWithAttachment) {
    return {
      code: 'sender-no-attachments',
      verdict: 'Hermes reached this deployment but did not claim any attachments',
      summary: 'Recent Hermes delivery traces reached this webui, but none of those sender traces claimed attachments, so the sender path is still not attempting file delivery here.',
      receiverHealthy,
      queueNotStuck,
      senderConfigVerified: false,
      verificationScope: 'receiver-only',
      checks
    };
  }

  if (database.attachmentStats.assistantAttachmentSignal === 'absent' || database.attachmentStats.assistantAttachmentSignal === 'rare') {
    return {
      code: 'upstream-likely',
      verdict: 'Receiver healthy, likely upstream sender or deployment issue',
      summary: recentSenderTraceSeen
        ? 'Based on receiver-side checks only: database and storage are healthy, the bucket exists, Hermes auth is configured, the queue is not stuck, and this deployment has seen Hermes sender traces, but assistant attachments are still absent or rare here.'
        : 'Based on receiver-side checks only: database and storage are healthy, the bucket exists, Hermes auth is configured, and the queue is not stuck, but assistant attachments are absent or rare on this receiver and no recent Hermes sender traces have reached this deployment.',
      receiverHealthy,
      queueNotStuck,
      senderConfigVerified: false,
      verificationScope: 'receiver-only',
      checks
    };
  }

  return {
    code: 'receiver-ready',
    verdict: 'Receiver has accepted assistant attachments before',
    summary: 'Receiver-side checks are healthy and assistant attachments have been stored here before, so webui can receive downloadable files when the sender posts them correctly.',
    receiverHealthy,
    queueNotStuck,
    senderConfigVerified: false,
    verificationScope: 'receiver-only',
    checks
  };
}

export async function collectMaintenanceSnapshot(event: RequestEvent) {
  const config = getConfig();
  const memoryUsage = process.memoryUsage();
  const workerHeartbeat = getHermesWorkerHeartbeat();
  const [build, database, storage, deliveryTraces, queue, recentAssistantTimings] = await Promise.all([
    getBuildInfo(),
    getDatabaseTelemetry(),
    getStorageTelemetry(),
    getHermesDeliveryTraceTelemetry(),
    getHermesQueueStats().catch((error) => ({
      queued: 0,
      processing: 0,
      acked: 0,
      staleProcessing: 0,
      leaseSeconds: config.hermesEventLeaseSeconds,
      error: error instanceof Error ? error.message : 'Queue query failed.'
    })),
    getRecentAssistantTimingsTelemetry()
  ]);

  return {
    collectedAt: new Date().toISOString(),
    build,
    runtime: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
      startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      hostname: hostname(),
      cwd: process.cwd(),
      env: process.env.NODE_ENV || 'development',
      memory: {
        rss: memoryUsage.rss,
        heapTotal: memoryUsage.heapTotal,
        heapUsed: memoryUsage.heapUsed,
        external: memoryUsage.external
      }
    },
    request: {
      origin: event.url.origin,
      pathname: event.url.pathname,
      host: event.request.headers.get('host'),
      forwardedHost: event.request.headers.get('x-forwarded-host'),
      forwardedProto: event.request.headers.get('x-forwarded-proto'),
      userAgent: event.request.headers.get('user-agent')
    },
    config: {
      publicAppName: config.publicAppName,
      database: {
        host: config.databaseHost,
        port: config.databasePort,
        name: config.databaseName
      },
      objectStorage: {
        endpoint: config.objectStorageEndpoint,
        port: config.objectStoragePort,
        useSsl: config.objectStorageUseSsl,
        bucket: config.objectStorageBucket,
        prefix: config.objectStoragePrefix
      },
      sessionCookieName: config.sessionCookieName,
      maintenanceCookieName: config.maintenanceCookieName,
      hermesServiceTokenConfigured: config.hermesServiceToken !== 'change-me' && config.hermesServiceToken.length > 0,
      maintenanceTokenConfigured: config.maintenanceToken.length > 0
    },
    database,
    storage,
    deliveryTraces,
    queue,
    workerHeartbeat,
    recentAssistantTimings,
    fileDeliveryDiagnosis: deriveFileDeliveryDiagnosis({
      database,
      storage,
      deliveryTraces,
      queue,
      workerHeartbeat,
      hermesServiceTokenConfigured:
        config.hermesServiceToken !== 'change-me' && config.hermesServiceToken.length > 0
    })
  };
}