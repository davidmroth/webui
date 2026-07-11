function getEnv(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

function getNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)));
}

export function getConfig() {
  const objectStorageEndpoint = getEnv('OBJECT_STORAGE_ENDPOINT', 'minio');
  const objectStoragePort = getNumber('OBJECT_STORAGE_PORT', 9000);
  const objectStorageUseSsl = getEnv('OBJECT_STORAGE_USE_SSL', 'false') === 'true';
  const objectStorageAccessKey = getEnv('OBJECT_STORAGE_ACCESS_KEY', 'minioadmin');
  const objectStorageSecretKey = getEnv('OBJECT_STORAGE_SECRET_KEY', 'minioadmin');
  const objectStorageBucket = getEnv('OBJECT_STORAGE_BUCKET', 'hermes-webui');
  const objectStorageRegion = getEnv('OBJECT_STORAGE_REGION', 'us-east-1');

  return {
    databaseHost: getEnv('DATABASE_HOST', 'mysql'),
    databasePort: getNumber('DATABASE_PORT', 3306),
    databaseName: getEnv('DATABASE_NAME', 'hermes_webui'),
    databaseUser: getEnv('DATABASE_USER', 'hermes'),
    databasePassword: getEnv('DATABASE_PASSWORD', 'hermes'),
    objectStorageEndpoint,
    objectStoragePort,
    objectStorageUseSsl,
    objectStorageAccessKey,
    objectStorageSecretKey,
    objectStorageBucket,
    objectStoragePrefix: getEnv('OBJECT_STORAGE_PREFIX', ''),
    objectStorageRegion,
    briefingStoragePrefix: getEnv('BRIEFING_STORAGE_PREFIX', 'webui/briefings'),
    sessionCookieName: getEnv('SESSION_COOKIE_NAME', 'hermes_webui_session'),
    hermesServiceToken: getEnv('HERMES_WEBCHAT_SERVICE_TOKEN', 'change-me'),
    hermesEventLeaseSeconds: getNumber('HERMES_EVENT_LEASE_SECONDS', 120),
    hermesWorkerHeartbeatStaleSeconds: getNumber('HERMES_WORKER_HEARTBEAT_STALE_SECONDS', 45),
    diagnosticsRingBufferSize: clampNumber(getNumber('DIAGNOSTICS_RING_BUFFER_SIZE', 1000), 100, 5000),
    diagnosticsStaleCheckIntervalSeconds: clampNumber(
      getNumber('DIAGNOSTICS_STALE_CHECK_INTERVAL_SECONDS', 15),
      5,
      300
    ),
    webPushVapidSubject: getEnv('WEB_PUSH_VAPID_SUBJECT', ''),
    webPushVapidPrivateKey: getEnv('WEB_PUSH_VAPID_PRIVATE_KEY', ''),
    publicWebPushVapidPublicKey: getEnv('PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY', ''),
    maintenanceToken: getEnv('MAINTENANCE_TOKEN', ''),
    maintenanceCookieName: getEnv('MAINTENANCE_COOKIE_NAME', 'hermes_webui_maintenance'),
    agentlensTestingEnabled: getEnv('AGENTLENS_TESTING_ENABLED', 'false') === 'true',
    agentlensBaseUrl: getEnv('AGENTLENS_BASE_URL', 'http://agentlens:8501'),
    agentlensTestingApiKey: getEnv('AGENTLENS_TESTING_API_KEY', ''),
    agentlensTestingTimeoutMs: clampNumber(getNumber('AGENTLENS_TESTING_TIMEOUT_MS', 15000), 2000, 120000),
    bootstrapUserName: getEnv('BOOTSTRAP_USER_NAME', 'Owner'),
    bootstrapUserKey: getEnv('BOOTSTRAP_USER_KEY', 'dev-webui-key'),
    publicAppName: getEnv('PUBLIC_APP_NAME', 'Hermes WebUI')
  };
}
