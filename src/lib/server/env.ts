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

export function getConfig() {
  return {
    databaseHost: getEnv('DATABASE_HOST', 'mysql'),
    databasePort: getNumber('DATABASE_PORT', 3306),
    databaseName: getEnv('DATABASE_NAME', 'hermes_webui'),
    databaseUser: getEnv('DATABASE_USER', 'hermes'),
    databasePassword: getEnv('DATABASE_PASSWORD', 'hermes'),
    objectStorageEndpoint: getEnv('OBJECT_STORAGE_ENDPOINT', 'minio'),
    objectStoragePort: getNumber('OBJECT_STORAGE_PORT', 9000),
    objectStorageUseSsl: getEnv('OBJECT_STORAGE_USE_SSL', 'false') === 'true',
    objectStorageAccessKey: getEnv('OBJECT_STORAGE_ACCESS_KEY', 'minioadmin'),
    objectStorageSecretKey: getEnv('OBJECT_STORAGE_SECRET_KEY', 'minioadmin'),
    objectStorageBucket: getEnv('OBJECT_STORAGE_BUCKET', 'hermes-webui'),
    sessionCookieName: getEnv('SESSION_COOKIE_NAME', 'hermes_webui_session'),
    hermesServiceToken: getEnv('HERMES_WEBCHAT_SERVICE_TOKEN', 'change-me'),
    hermesEventLeaseSeconds: getNumber('HERMES_EVENT_LEASE_SECONDS', 120),
    maintenanceToken: getEnv('MAINTENANCE_TOKEN', ''),
    maintenanceCookieName: getEnv('MAINTENANCE_COOKIE_NAME', 'hermes_webui_maintenance'),
    bootstrapUserName: getEnv('BOOTSTRAP_USER_NAME', 'Owner'),
    bootstrapUserKey: getEnv('BOOTSTRAP_USER_KEY', 'dev-webui-key'),
    publicAppName: getEnv('PUBLIC_APP_NAME', 'Hermes WebUI')
  };
}
