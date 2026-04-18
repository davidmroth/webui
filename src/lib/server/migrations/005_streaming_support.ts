import { execute, columnExists, type Migration } from './helpers';

export const migration: Migration = {
  id: '005_streaming_support',
  description: 'Add hermes_message_chunks table + cancelled event status for token streaming',
  up: async () => {
    // Per-message append-only chunk log used by SSE streaming.
    await execute(`
      CREATE TABLE IF NOT EXISTS hermes_message_chunks (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        message_id CHAR(36) NOT NULL,
        seq INT NOT NULL,
        delta LONGTEXT NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        UNIQUE KEY uniq_message_seq (message_id, seq),
        INDEX idx_chunks_message_created (message_id, created_at),
        CONSTRAINT fk_chunks_message FOREIGN KEY (message_id)
          REFERENCES messages(id) ON DELETE CASCADE
      )
    `);

    // Allow events to be marked cancelled when the user clicks Stop.
    // The status column is an ENUM, so we extend it in-place.
    await execute(
      "ALTER TABLE hermes_events MODIFY COLUMN status ENUM('queued','processing','acked','cancelled') NOT NULL DEFAULT 'queued'"
    );

    // cancelled_at marker for audit; harmless if it already exists.
    if (!(await columnExists('hermes_events', 'cancelled_at'))) {
      await execute('ALTER TABLE hermes_events ADD COLUMN cancelled_at DATETIME NULL AFTER acked_at');
    }
  }
};
