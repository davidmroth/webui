import { Client } from 'minio';
import { randomUUID } from 'node:crypto';
import { getConfig } from './env';

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

export async function uploadObject(params: {
  conversationId: string;
  messageId: string;
  fileName: string;
  contentType: string;
  buffer: Buffer;
}) {
  await ensureStorageBucket();
  const config = getConfig();
  const client = createStorageClient();
  const objectKey = `${params.conversationId}/${params.messageId}/${randomUUID()}-${params.fileName}`;
  await client.putObject(config.objectStorageBucket, objectKey, params.buffer, params.buffer.length, {
    'Content-Type': params.contentType
  });
  return {
    bucket: config.objectStorageBucket,
    key: objectKey,
    sizeBytes: params.buffer.length
  };
}

export async function getObjectBuffer(storageKey: string): Promise<Buffer> {
  await ensureStorageBucket();
  const config = getConfig();
  const client = createStorageClient();
  const stream = await client.getObject(config.objectStorageBucket, storageKey);
  return streamToBuffer(stream);
}
