import { execute, type Migration, columnExists, indexExists } from './helpers';

async function addColumnIfMissing(table: string, column: string, definition: string) {
  if (!(await columnExists(table, column))) {
    await execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

async function addIndexIfMissing(table: string, index: string, definition: string) {
  if (!(await indexExists(table, index))) {
    await execute(`ALTER TABLE ${table} ADD ${definition}`);
  }
}

export const migration: Migration = {
  id: '004_llamacpp_parity',
  description: 'Add upstream llama.cpp webui parity columns (parent_id, reasoning, timings, prefs)',
  up: async () => {
    // messages: branching + reasoning + tool_calls + extras + timings + model + type + msg_timestamp
    await addColumnIfMissing('messages', 'parent_id', 'CHAR(36) NULL AFTER conversation_id');
    await addColumnIfMissing('messages', 'reasoning_content', 'LONGTEXT NULL AFTER content');
    await addColumnIfMissing('messages', 'tool_calls', 'JSON NULL AFTER reasoning_content');
    await addColumnIfMissing('messages', 'extra', 'JSON NULL AFTER tool_calls');
    await addColumnIfMissing('messages', 'timings', 'JSON NULL AFTER extra');
    await addColumnIfMissing('messages', 'model', 'VARCHAR(255) NULL AFTER timings');
    await addColumnIfMissing(
      'messages',
      'type',
      "ENUM('text','root') NOT NULL DEFAULT 'text' AFTER model"
    );
    await addColumnIfMissing(
      'messages',
      'msg_timestamp',
      'BIGINT NOT NULL DEFAULT 0 AFTER created_at'
    );

    await addIndexIfMissing(
      'messages',
      'idx_messages_parent',
      'INDEX idx_messages_parent (parent_id)'
    );
    await addIndexIfMissing(
      'messages',
      'idx_messages_conv_created',
      'INDEX idx_messages_conv_created (conversation_id, created_at)'
    );

    // conversations: curr_node, last_modified, forked_from
    await addColumnIfMissing('conversations', 'curr_node', 'CHAR(36) NULL AFTER title');
    await addColumnIfMissing(
      'conversations',
      'last_modified',
      'BIGINT NOT NULL DEFAULT 0 AFTER updated_at'
    );
    await addColumnIfMissing(
      'conversations',
      'forked_from_conversation_id',
      'CHAR(36) NULL AFTER last_modified'
    );

    // user_preferences table
    await execute(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        user_id CHAR(36) PRIMARY KEY,
        theme VARCHAR(32) NOT NULL DEFAULT 'system',
        sampling JSON NULL,
        default_model VARCHAR(255) NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_user_preferences_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // FULLTEXT indexes (best-effort; require InnoDB w/ FT support which MySQL 5.6+ provides)
    if (!(await indexExists('messages', 'ft_messages_content'))) {
      try {
        await execute('ALTER TABLE messages ADD FULLTEXT INDEX ft_messages_content (content)');
      } catch {
        // ignore if engine doesn't support
      }
    }
    if (!(await indexExists('conversations', 'ft_conversations_title'))) {
      try {
        await execute('ALTER TABLE conversations ADD FULLTEXT INDEX ft_conversations_title (title)');
      } catch {
        // ignore
      }
    }

    // Backfill: linear parent_id chain per conversation, curr_node = latest
    await execute(`
      UPDATE messages AS m
      LEFT JOIN (
        SELECT m1.id AS this_id, (
          SELECT m2.id FROM messages m2
          WHERE m2.conversation_id = m1.conversation_id
            AND m2.created_at < m1.created_at
          ORDER BY m2.created_at DESC, m2.id DESC LIMIT 1
        ) AS prev_id
        FROM messages m1
      ) AS chain ON chain.this_id = m.id
      SET m.parent_id = chain.prev_id
      WHERE m.parent_id IS NULL
    `);

    await execute(`
      UPDATE messages
      SET msg_timestamp = UNIX_TIMESTAMP(created_at) * 1000
      WHERE msg_timestamp = 0
    `);

    await execute(`
      UPDATE conversations c
      SET curr_node = (
        SELECT id FROM messages m
        WHERE m.conversation_id = c.id
        ORDER BY m.created_at DESC, m.id DESC LIMIT 1
      )
      WHERE curr_node IS NULL
    `);

    await execute(`
      UPDATE conversations
      SET last_modified = UNIX_TIMESTAMP(updated_at) * 1000
      WHERE last_modified = 0
    `);
  }
};
