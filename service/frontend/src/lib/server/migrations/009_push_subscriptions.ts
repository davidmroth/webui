import { execute, indexExists, type Migration } from './helpers';

export const migration: Migration = {
  id: '009_push_subscriptions',
  description: 'Store browser push subscriptions for Web Push delivery',
  up: async () => {
    await execute(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id CHAR(36) PRIMARY KEY,
        user_id CHAR(36) NOT NULL,
        endpoint_hash CHAR(64) NOT NULL,
        subscription JSON NOT NULL,
        user_agent VARCHAR(255) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        last_success_at DATETIME NULL,
        last_error_at DATETIME NULL,
        last_error_text TEXT NULL,
        CONSTRAINT fk_push_subscriptions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY uniq_push_subscriptions_endpoint_hash (endpoint_hash)
      )
    `);

    if (!(await indexExists('push_subscriptions', 'idx_push_subscriptions_user_updated'))) {
      await execute(
        'CREATE INDEX idx_push_subscriptions_user_updated ON push_subscriptions (user_id, updated_at)'
      );
    }
  }
};