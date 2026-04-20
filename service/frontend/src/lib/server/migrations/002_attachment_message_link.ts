import { columnExists, execute, foreignKeyExists, indexExists, type Migration } from './helpers';

export const migration: Migration = {
  id: '002_attachment_message_link',
  description: 'Add message linkage to attachments',
  up: async () => {
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
};