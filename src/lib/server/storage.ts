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
  const exists = await client.bucketExists(config.objectStorageBucket).catch(() => false);
  if (!exists) {
    await client.makeBucket(config.objectStorageBucket, 'us-east-1');
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
