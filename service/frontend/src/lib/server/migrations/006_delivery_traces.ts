import { execute, type Migration } from './helpers';

export const migration: Migration = {
  id: '006_delivery_traces',
  description: 'Add Hermes delivery trace storage for sender/receiver correlation',
  up: async () => {
    await execute(`
      CREATE TABLE IF NOT EXISTS hermes_delivery_traces (
        id CHAR(36) PRIMARY KEY,
        sender_trace_id CHAR(36) NULL,
        conversation_id CHAR(36) NOT NULL,
        receiver_message_id CHAR(36) NULL,
        route VARCHAR(64) NOT NULL DEFAULT 'unknown',
        sender_base_url VARCHAR(255) NULL,
        sender_target_url VARCHAR(255) NULL,
        sender_hostname VARCHAR(255) NULL,
        sender_session_platform VARCHAR(64) NULL,
        sender_session_chat_id VARCHAR(255) NULL,
        attachment_count INT NOT NULL DEFAULT 0,
        attachment_names JSON NULL,
        content_length INT NOT NULL DEFAULT 0,
        receiver_status ENUM('accepted', 'rejected') NOT NULL DEFAULT 'accepted',
        error_text TEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_delivery_traces_created (created_at),
        INDEX idx_delivery_traces_conversation_created (conversation_id, created_at)
      )
    `);
  }
};