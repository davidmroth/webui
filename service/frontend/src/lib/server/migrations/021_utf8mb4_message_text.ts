import { execute, type Migration } from './helpers';

export const migration: Migration = {
  id: '021_utf8mb4_message_text',
  description: 'Ensure message text columns use utf8mb4 for emoji storage',
  up: async () => {
    await execute(`
      ALTER TABLE messages
      CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);

    await execute(`
      ALTER TABLE hermes_message_chunks
      CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
  }
};
