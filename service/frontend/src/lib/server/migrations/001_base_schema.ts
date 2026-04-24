import { execute, type Migration } from './helpers';

export const migration: Migration = {
  id: '001_base_schema',
  description: 'Create base application schema',
  up: async () => {
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
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
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
};