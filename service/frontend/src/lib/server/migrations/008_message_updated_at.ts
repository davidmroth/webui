import { columnExists, execute, type Migration } from './helpers';

export const migration: Migration = {
  id: '008_message_updated_at',
  description: 'Add messages.updated_at for message revision timestamps',
  up: async () => {
    if (!(await columnExists('messages', 'updated_at'))) {
      await execute('ALTER TABLE messages ADD COLUMN updated_at DATETIME NULL AFTER created_at');
    }

    await execute(`
      UPDATE messages
      SET updated_at = created_at
      WHERE updated_at IS NULL
    `);

    await execute(`
      ALTER TABLE messages
      MODIFY COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      AFTER created_at
    `);
  }
};