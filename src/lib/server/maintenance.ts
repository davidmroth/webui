import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { createStorageClient } from './storage';
import { getHermesQueueStats } from './chat';
import { getConfig } from './env';
import { query } from './db';
import type { RequestEvent } from '@sveltejs/kit';

interface BuildInfo {
  source: 'version.json' | '.build.json' | 'package.json';
  frontend: string;
  gitTag: string | null;
  gitCommit: string | null;
  gitCommitShort: string | null;
  gitBranch: string | null;
  buildTime: string | null;
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

export async function getBuildInfo(): Promise<BuildInfo> {
  const cwd = process.cwd();
  const versionJson = await readJsonFile<Partial<BuildInfo>>(
    resolve(cwd, 'version.json')
  );
  if (versionJson) {
    return {
      source: 'version.json',
      frontend: String(versionJson.frontend ?? '0.0.0'),
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
      frontend: String(buildJson.frontend ?? '0.0.0'),
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
    frontend: String(packageJson?.version ?? '0.0.0'),
    gitTag: null,
    gitCommit: null,
    gitCommitShort: null,
    gitBranch: null,
    buildTime: null
  };
}

async function getDatabaseTelemetry() {
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

export async function collectMaintenanceSnapshot(event: RequestEvent) {
  const config = getConfig();
  const memoryUsage = process.memoryUsage();
  const [build, database, storage, queue] = await Promise.all([
    getBuildInfo(),
    getDatabaseTelemetry(),
    getStorageTelemetry(),
    getHermesQueueStats().catch((error) => ({
      queued: 0,
      processing: 0,
      acked: 0,
      staleProcessing: 0,
      leaseSeconds: config.hermesEventLeaseSeconds,
      error: error instanceof Error ? error.message : 'Queue query failed.'
    }))
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
        bucket: config.objectStorageBucket
      },
      sessionCookieName: config.sessionCookieName,
      maintenanceCookieName: config.maintenanceCookieName,
      hermesServiceTokenConfigured: config.hermesServiceToken !== 'change-me' && config.hermesServiceToken.length > 0,
      maintenanceTokenConfigured: config.maintenanceToken.length > 0
    },
    database,
    storage,
    queue
  };
}