import { execute, columnExists, indexExists, type Migration } from './helpers';

export const migration: Migration = {
  id: '010_mobile_resilient_chat_state',
  description: 'Add durable chat run state and mobile push delivery metadata',
  up: async () => {
    await execute(
      "ALTER TABLE hermes_events MODIFY COLUMN status ENUM('queued','processing','acked','cancelled') NOT NULL DEFAULT 'queued'"
    );

    if (!(await columnExists('hermes_events', 'run_status'))) {
      await execute(
        "ALTER TABLE hermes_events ADD COLUMN run_status ENUM('queued','processing','completed','failed','cancelled','stale') NOT NULL DEFAULT 'queued' AFTER status"
      );
    }

    if (!(await columnExists('hermes_events', 'run_completed_at'))) {
      await execute('ALTER TABLE hermes_events ADD COLUMN run_completed_at DATETIME NULL AFTER cancelled_at');
    }

    if (!(await columnExists('hermes_events', 'run_error_code'))) {
      await execute('ALTER TABLE hermes_events ADD COLUMN run_error_code VARCHAR(64) NULL AFTER run_completed_at');
    }

    if (!(await columnExists('hermes_events', 'run_error_message'))) {
      await execute('ALTER TABLE hermes_events ADD COLUMN run_error_message TEXT NULL AFTER run_error_code');
    }

    if (!(await indexExists('hermes_events', 'idx_hermes_events_run_status'))) {
      await execute(
        'CREATE INDEX idx_hermes_events_run_status ON hermes_events (conversation_id, run_status, created_at)'
      );
    }

    if (!(await columnExists('push_subscriptions', 'vapid_key_fingerprint'))) {
      await execute(
        'ALTER TABLE push_subscriptions ADD COLUMN vapid_key_fingerprint CHAR(64) NULL AFTER user_agent'
      );
    }

    if (!(await columnExists('push_subscriptions', 'last_failure_code'))) {
      await execute(
        'ALTER TABLE push_subscriptions ADD COLUMN last_failure_code VARCHAR(64) NULL AFTER last_error_text'
      );
    }

    await execute(`
      CREATE TABLE IF NOT EXISTS push_notification_queue (
        id CHAR(36) PRIMARY KEY,
        user_id CHAR(36) NOT NULL,
        conversation_id CHAR(36) NOT NULL,
        message_id CHAR(36) NULL,
        event_type ENUM('assistant_completed','assistant_failed','assistant_stale','needs_attention') NOT NULL,
        payload JSON NOT NULL,
        status ENUM('queued','processing','sent','failed','cancelled') NOT NULL DEFAULT 'queued',
        attempt_count INT NOT NULL DEFAULT 0,
        next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_attempt_at DATETIME NULL,
        last_error_code VARCHAR(64) NULL,
        last_error_text TEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_push_notification_queue_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_push_notification_queue_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
        CONSTRAINT fk_push_notification_queue_message FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL,
        INDEX idx_push_notification_queue_status_next (status, next_attempt_at),
        INDEX idx_push_notification_queue_conversation_created (conversation_id, created_at)
      )
    `);
  }
};
