import { Client } from 'minio';
import { randomUUID } from 'node:crypto';
import { getConfig } from './env';
import { DiagnosticEventType, DiagnosticHop, emitDiagnosticEvent } from './diagnostics';

let initialized = false;

export function createStorageClient() {
  const config = getConfig();
  return new Client({
    endPoint: config.objectStorageEndpoint,
    port: config.objectStoragePort,
    useSSL: config.objectStorageUseSsl,
    accessKey: config.objectStorageAccessKey,
    secretKey: config.objectStorageSecretKey
  });
}

export async function ensureStorageBucket() {
  if (initialized) {
    return;
  }
  const config = getConfig();
  const client = createStorageClient();
  let exists: boolean | null = null;
  try {
    exists = await client.bucketExists(config.objectStorageBucket);
  } catch {
    // Some S3-compatible providers deny bucket existence checks unless extra IAM
    // permissions are granted. Continue and let putObject/getObject decide.
    exists = null;
  }

  if (exists === false) {
    try {
      await client.makeBucket(config.objectStorageBucket, config.objectStorageRegion);
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
  initialized = true;
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
  const config = getConfig();
  const client = createStorageClient();
  const keyBase = `${params.conversationId}/${params.messageId}/${randomUUID()}-${params.fileName}`;
  const prefix = normalizeObjectStoragePrefix(config.objectStoragePrefix);
  const objectKey = prefix ? `${prefix}/${keyBase}` : keyBase;
  try {
    await client.putObject(config.objectStorageBucket, objectKey, params.buffer, params.buffer.length, {
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
    bucket: config.objectStorageBucket,
    prefixConfigured: Boolean(prefix)
  }, params.conversationId);
  return {
    bucket: config.objectStorageBucket,
    key: objectKey,
    sizeBytes: params.buffer.length
  };
}

export async function getObjectBuffer(storageKey: string): Promise<Buffer> {
  const startedAt = Date.now();
  await ensureStorageBucket();
  const config = getConfig();
  const client = createStorageClient();
  try {
    const stream = await client.getObject(config.objectStorageBucket, storageKey);
    const buffer = await streamToBuffer(stream);
    emitDiagnosticEvent(DiagnosticEventType.AttachmentDownloadSucceeded, DiagnosticHop.ObjectStorage, {
      sizeBytes: buffer.length,
      durationMs: Date.now() - startedAt,
      bucket: config.objectStorageBucket
    });
    return buffer;
  } catch (error) {
    emitDiagnosticEvent(DiagnosticEventType.AttachmentDownloadFailed, DiagnosticHop.ObjectStorage, {
      durationMs: Date.now() - startedAt,
      bucket: config.objectStorageBucket,
      errorClass: error instanceof Error ? error.constructor.name : typeof error,
      errorMessage: error instanceof Error ? error.message : 'Object download failed.'
    });
    throw error;
  }
}
