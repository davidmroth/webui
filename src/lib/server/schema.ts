import { execute, query } from './db';

interface SchemaMigrationRow {
  id: string;
}

let schemaReadyPromise: Promise<void> | null = null;

async function columnExists(tableName: string, columnName: string) {
  const rows = await query<{ count: number }>(
    `SELECT COUNT(*) AS count
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = :table_name
       AND COLUMN_NAME = :column_name`,
    { table_name: tableName, column_name: columnName }
  );
  return (rows[0]?.count ?? 0) > 0;
}

async function indexExists(tableName: string, indexName: string) {
  const rows = await query<{ count: number }>(
    `SELECT COUNT(*) AS count
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = :table_name
       AND INDEX_NAME = :index_name`,
    { table_name: tableName, index_name: indexName }
  );
  return (rows[0]?.count ?? 0) > 0;
}

async function foreignKeyExists(tableName: string, constraintName: string) {
  const rows = await query<{ count: number }>(
    `SELECT COUNT(*) AS count
     FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = :table_name
       AND CONSTRAINT_NAME = :constraint_name
       AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
    { table_name: tableName, constraint_name: constraintName }
  );
  return (rows[0]?.count ?? 0) > 0;
}

async function createBaseTables() {
  await execute(`
    CREATE TABLE IF NOT EXISTS users (
      id CHAR(36) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL UNIQUE,
      display_name VARCHAR(120) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await execute(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      label VARCHAR(120) NOT NULL,
      key_hash CHAR(64) NOT NULL UNIQUE,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      revoked_at DATETIME NULL,
      CONSTRAINT fk_api_keys_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await execute(`
    CREATE TABLE IF NOT EXISTS web_sessions (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      session_token_hash CHAR(64) NOT NULL UNIQUE,
      expires_at DATETIME NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_web_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await execute(`
    CREATE TABLE IF NOT EXISTS conversations (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      title VARCHAR(200) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_conversations_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await execute(`
    CREATE TABLE IF NOT EXISTS messages (
      id CHAR(36) PRIMARY KEY,
      conversation_id CHAR(36) NOT NULL,
      role ENUM('user', 'assistant', 'system') NOT NULL,
      content LONGTEXT NOT NULL,
      source ENUM('browser', 'hermes') NOT NULL,
      status ENUM('complete', 'streaming', 'error') NOT NULL DEFAULT 'complete',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_messages_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    )
  `);

  await execute(`
    CREATE TABLE IF NOT EXISTS hermes_events (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      conversation_id CHAR(36) NOT NULL,
      message_id CHAR(36) NOT NULL,
      event_type ENUM('message') NOT NULL DEFAULT 'message',
      status ENUM('queued', 'processing', 'acked') NOT NULL DEFAULT 'queued',
      payload JSON NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      claimed_at DATETIME NULL,
      acked_at DATETIME NULL,
      CONSTRAINT fk_hermes_events_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_hermes_events_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      CONSTRAINT fk_hermes_events_message FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      INDEX idx_hermes_events_status_created (status, created_at)
    )
  `);

  await execute(`
    CREATE TABLE IF NOT EXISTS attachments (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      conversation_id CHAR(36) NULL,
      message_id CHAR(36) NULL,
      storage_bucket VARCHAR(120) NOT NULL,
      storage_key VARCHAR(255) NOT NULL,
      file_name VARCHAR(255) NOT NULL,
      content_type VARCHAR(120) NOT NULL,
      size_bytes BIGINT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_attachments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_attachments_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL,
      CONSTRAINT fk_attachments_message FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL,
      INDEX idx_attachments_message (message_id)
    )
  `);
}

async function ensureAttachmentMessageLink() {
  if (!(await columnExists('attachments', 'message_id'))) {
    await execute('ALTER TABLE attachments ADD COLUMN message_id CHAR(36) NULL AFTER conversation_id');
  }

  if (!(await indexExists('attachments', 'idx_attachments_message'))) {
    await execute('ALTER TABLE attachments ADD INDEX idx_attachments_message (message_id)');
  }

  if (!(await foreignKeyExists('attachments', 'fk_attachments_message'))) {
    await execute(
      'ALTER TABLE attachments ADD CONSTRAINT fk_attachments_message FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL'
    );
  }
}

const migrations = [
  {
    id: '001_base_schema',
    up: createBaseTables
  },
  {
    id: '002_attachment_message_link',
    up: ensureAttachmentMessageLink
  }
];

async function runSchemaMigrations() {
  await execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id VARCHAR(128) PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const appliedRows = await query<SchemaMigrationRow>('SELECT id FROM schema_migrations');
  const applied = new Set(appliedRows.map((row) => row.id));

  for (const migration of migrations) {
    if (applied.has(migration.id)) {
      continue;
    }

    await migration.up();
    await execute('INSERT INTO schema_migrations (id) VALUES (:id)', { id: migration.id });
  }
}

export function ensureDatabaseSchema() {
  if (!schemaReadyPromise) {
    schemaReadyPromise = runSchemaMigrations().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }

  return schemaReadyPromise;
}