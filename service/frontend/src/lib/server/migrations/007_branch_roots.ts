import { randomUUID } from 'node:crypto';
import { execute, query, type Migration } from './helpers';

interface ConversationWithoutRootRow {
  id: string;
  created_at: Date | string;
  curr_node: string | null;
}

function toUnixMilliseconds(value: Date | string) {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

export const migration: Migration = {
  id: '007_branch_roots',
  description: 'Create synthetic conversation root messages for branch-aware revisions',
  up: async () => {
    await execute(`
      UPDATE messages
      SET msg_timestamp = UNIX_TIMESTAMP(created_at) * 1000
      WHERE msg_timestamp = 0
    `);

    await execute(`
      UPDATE conversations
      SET last_modified = UNIX_TIMESTAMP(updated_at) * 1000
      WHERE last_modified = 0
    `);

    const conversations = await query<ConversationWithoutRootRow>(`
      SELECT conversations.id, conversations.created_at, conversations.curr_node
      FROM conversations
      LEFT JOIN messages roots
        ON roots.conversation_id = conversations.id
       AND roots.type = 'root'
      WHERE roots.id IS NULL
      ORDER BY conversations.created_at ASC
    `);

    for (const conversation of conversations) {
      const rootId = randomUUID();
      const timestamp = toUnixMilliseconds(conversation.created_at);

      await execute(
        `INSERT INTO messages (
           id,
           conversation_id,
           parent_id,
           role,
           content,
           source,
           status,
           created_at,
           type,
           msg_timestamp
         ) VALUES (
           :id,
           :conversation_id,
           NULL,
           'system',
           '',
           'hermes',
           'complete',
           :created_at,
           'root',
           :msg_timestamp
         )`,
        {
          id: rootId,
          conversation_id: conversation.id,
          created_at: conversation.created_at,
          msg_timestamp: timestamp
        }
      );

      await execute(
        `UPDATE messages
         SET parent_id = :root_id
         WHERE conversation_id = :conversation_id
           AND id <> :root_id
           AND parent_id IS NULL`,
        { root_id: rootId, conversation_id: conversation.id }
      );

      if (!conversation.curr_node) {
        await execute(
          `UPDATE conversations
           SET curr_node = :curr_node
           WHERE id = :id`,
          { curr_node: rootId, id: conversation.id }
        );
      }
    }
  }
};