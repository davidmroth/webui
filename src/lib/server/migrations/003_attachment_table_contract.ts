import { columnExists, execute, foreignKeyExists, type Migration } from './helpers';

export const migration: Migration = {
  id: '003_attachment_table_contract',
  description: 'Backfill missing attachment metadata columns for upgraded databases',
  up: async () => {
    if (!(await columnExists('attachments', 'conversation_id'))) {
      await execute('ALTER TABLE attachments ADD COLUMN conversation_id CHAR(36) NULL AFTER user_id');
    }

    if (!(await columnExists('attachments', 'storage_bucket'))) {
      await execute("ALTER TABLE attachments ADD COLUMN storage_bucket VARCHAR(120) NOT NULL DEFAULT '' AFTER message_id");
    }

    if (!(await columnExists('attachments', 'file_name'))) {
      await execute("ALTER TABLE attachments ADD COLUMN file_name VARCHAR(255) NOT NULL DEFAULT 'attachment' AFTER storage_key");
    }

    if (!(await columnExists('attachments', 'content_type'))) {
      await execute("ALTER TABLE attachments ADD COLUMN content_type VARCHAR(120) NOT NULL DEFAULT 'application/octet-stream' AFTER file_name");
    }

    if (!(await columnExists('attachments', 'size_bytes'))) {
      await execute('ALTER TABLE attachments ADD COLUMN size_bytes BIGINT NOT NULL DEFAULT 0 AFTER content_type');
    }

    if (!(await columnExists('attachments', 'created_at'))) {
      await execute('ALTER TABLE attachments ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER size_bytes');
    }

    if (!(await foreignKeyExists('attachments', 'fk_attachments_conversation'))) {
      await execute(
        'ALTER TABLE attachments ADD CONSTRAINT fk_attachments_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL'
      );
    }
  }
};