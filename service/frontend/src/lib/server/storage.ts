import { Client } from 'minio';
import { randomUUID } from 'node:crypto';
import { getConfig } from './env';
import { DiagnosticEventType, DiagnosticHop, emitDiagnosticEvent } from './diagnostics';

type StorageConnectionConfig = {
  endpoint: string;
  port: number;
  useSsl: boolean;
  accessKey: string;
  secretKey: string;
  bucket: string;
  region: string;
};

const initializedTargets = new Set<string>();

function objectStorageConfig(): StorageConnectionConfig {
  const config = getConfig();
  return {
    endpoint: config.objectStorageEndpoint,
    port: config.objectStoragePort,
    useSsl: config.objectStorageUseSsl,
    accessKey: config.objectStorageAccessKey,
    secretKey: config.objectStorageSecretKey,
    bucket: config.objectStorageBucket,
    region: config.objectStorageRegion
  };
}

function briefingStorageConfig(): StorageConnectionConfig {
  return objectStorageConfig();
}

function storageTargetKey(config: StorageConnectionConfig) {
  return [config.endpoint, config.port, config.bucket, config.region, config.useSsl ? 'ssl' : 'plain'].join('|');
}

export function createStorageClient() {
  const config = objectStorageConfig();
  return new Client({
    endPoint: config.endpoint,
    port: config.port,
    useSSL: config.useSsl,
    accessKey: config.accessKey,
    secretKey: config.secretKey
  });
}

function createConfiguredStorageClient(config: StorageConnectionConfig) {
  return new Client({
    endPoint: config.endpoint,
    port: config.port,
    useSSL: config.useSsl,
    accessKey: config.accessKey,
    secretKey: config.secretKey
  });
}

export async function ensureStorageBucket() {
  await ensureConfiguredStorageBucket(objectStorageConfig());
}

async function ensureConfiguredStorageBucket(config: StorageConnectionConfig) {
  const targetKey = storageTargetKey(config);
  if (initializedTargets.has(targetKey)) {
    return;
  }
  const client = createConfiguredStorageClient(config);
  let exists: boolean | null = null;
  try {
    exists = await client.bucketExists(config.bucket);
  } catch {
    // Some S3-compatible providers deny bucket existence checks unless extra IAM
    // permissions are granted. Continue and let putObject/getObject decide.
    exists = null;
  }

  if (exists === false) {
    try {
      await client.makeBucket(config.bucket, config.region);
    } catch (error) {
      // In production the bucket is often pre-provisioned and credentials may
      // intentionally exclude create/list permissions.
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String((error as { code?: unknown }).code ?? '')
          : '';
      const alreadyExists =
        code === 'BucketAlreadyExists' ||
        code === 'BucketAlreadyOwnedByYou' ||
        code === 'OperationAborted';
      const permissionDenied = code === 'AccessDenied' || code === 'AllAccessDisabled';
      if (!alreadyExists && !permissionDenied) {
        throw error;
      }
    }
  }
  initializedTargets.add(targetKey);
}

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

function normalizeObjectStoragePrefix(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  return trimmed
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .split('/')
    .filter((segment) => segment.length > 0)
    .join('/');
}

export async function uploadObject(params: {
  conversationId: string;
  messageId: string;
  fileName: string;
  contentType: string;
  buffer: Buffer;
}) {
  const startedAt = Date.now();
  await ensureStorageBucket();
  const config = objectStorageConfig();
  const client = createConfiguredStorageClient(config);
  const keyBase = `${params.conversationId}/${params.messageId}/${randomUUID()}-${params.fileName}`;
  const prefix = normalizeObjectStoragePrefix(getConfig().objectStoragePrefix);
  const objectKey = prefix ? `${prefix}/${keyBase}` : keyBase;
  try {
    await client.putObject(config.bucket, objectKey, params.buffer, params.buffer.length, {
      'Content-Type': params.contentType
    });
  } catch (error) {
    emitDiagnosticEvent(DiagnosticEventType.AttachmentUploadFailed, DiagnosticHop.ObjectStorage, {
      conversationId: params.conversationId,
      messageId: params.messageId,
      sizeBytes: params.buffer.length,
      durationMs: Date.now() - startedAt,
      errorClass: error instanceof Error ? error.constructor.name : typeof error,
      errorMessage: error instanceof Error ? error.message : 'Object upload failed.'
    }, params.conversationId);
    throw error;
  }
  emitDiagnosticEvent(DiagnosticEventType.AttachmentUploadSucceeded, DiagnosticHop.ObjectStorage, {
    conversationId: params.conversationId,
    messageId: params.messageId,
    sizeBytes: params.buffer.length,
    durationMs: Date.now() - startedAt,
    bucket: config.bucket,
    prefixConfigured: Boolean(prefix)
  }, params.conversationId);
  return {
    bucket: config.bucket,
    key: objectKey,
    sizeBytes: params.buffer.length
  };
}

export async function getObjectBuffer(storageKey: string): Promise<Buffer> {
  return getConfiguredObjectBuffer(storageKey, objectStorageConfig());
}

export async function getBriefingObjectBuffer(storageKey: string): Promise<Buffer> {
  return getConfiguredObjectBuffer(storageKey, briefingStorageConfig());
}

async function getConfiguredObjectBuffer(storageKey: string, config: StorageConnectionConfig): Promise<Buffer> {
  const startedAt = Date.now();
  await ensureConfiguredStorageBucket(config);
  const client = createConfiguredStorageClient(config);
  try {
    const stream = await client.getObject(config.bucket, storageKey);
    const buffer = await streamToBuffer(stream);
    emitDiagnosticEvent(DiagnosticEventType.AttachmentDownloadSucceeded, DiagnosticHop.ObjectStorage, {
      sizeBytes: buffer.length,
      durationMs: Date.now() - startedAt,
      bucket: config.bucket
    });
    return buffer;
  } catch (error) {
    emitDiagnosticEvent(DiagnosticEventType.AttachmentDownloadFailed, DiagnosticHop.ObjectStorage, {
      durationMs: Date.now() - startedAt,
      bucket: config.bucket,
      errorClass: error instanceof Error ? error.constructor.name : typeof error,
      errorMessage: error instanceof Error ? error.message : 'Object download failed.'
    });
    throw error;
  }
}
