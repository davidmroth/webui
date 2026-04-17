import { Client } from 'minio';
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
