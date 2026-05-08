import type { Migration } from './helpers';
import { execute } from './helpers';

export const migration: Migration = {
  id: '013_slash_command_cache',
  description: 'Persist the Hermes slash command cache across WebUI restarts',
  async up() {
    await execute(`
      CREATE TABLE IF NOT EXISTS slash_command_cache (
        cache_key VARCHAR(64) PRIMARY KEY,
        commands_json LONGTEXT NOT NULL,
        synced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
  }
};