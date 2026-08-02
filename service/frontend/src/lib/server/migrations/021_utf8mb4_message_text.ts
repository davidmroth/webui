import { execute, query, type Migration } from './helpers';

async function tableCharset(tableName: string): Promise<string | null> {
  const rows = await query<{ CHARACTER_SET_NAME: string }>(
    `SELECT CCSA.CHARACTER_SET_NAME AS CHARACTER_SET_NAME
     FROM information_schema.TABLES AS T
     JOIN information_schema.COLLATION_CHARACTER_SET_APPLICABILITY AS CCSA
       ON CCSA.COLLATION_NAME = T.TABLE_COLLATION
     WHERE T.TABLE_SCHEMA = DATABASE()
       AND T.TABLE_NAME = :table_name`,
    { table_name: tableName }
  );
  return rows[0]?.CHARACTER_SET_NAME ?? null;
}

async function tableCollation(tableName: string): Promise<string | null> {
  const rows = await query<{ TABLE_COLLATION: string }>(
    `SELECT TABLE_COLLATION
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = :table_name`,
    { table_name: tableName }
  );
  return rows[0]?.TABLE_COLLATION ?? null;
}

async function ensureUtf8mb4(tableName: string, matchParent?: string) {
  const charset = await tableCharset(tableName);
  if (charset === 'utf8mb4') {
    // Already emoji-capable; do not CONVERT (changes collation and breaks FKs).
    return;
  }

  let collation = 'utf8mb4_unicode_ci';
  if (matchParent) {
    const parentCollation = await tableCollation(matchParent);
    if (parentCollation?.startsWith('utf8mb4_')) {
      collation = parentCollation;
    } else if ((await tableCharset(matchParent)) !== 'utf8mb4') {
      await execute(
        `ALTER TABLE \`${matchParent}\`
         CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
      );
      collation = 'utf8mb4_unicode_ci';
    }
  }

  if (!/^utf8mb4_[A-Za-z0-9_]+$/.test(collation)) {
    throw new Error(`Refusing unexpected collation for ${tableName}: ${collation}`);
  }

  await execute(
    `ALTER TABLE \`${tableName}\`
     CONVERT TO CHARACTER SET utf8mb4 COLLATE ${collation}`
  );
}

export const migration: Migration = {
  id: '021_utf8mb4_message_text',
  description: 'Ensure message text columns use utf8mb4 for emoji storage',
  up: async () => {
    // CONVERT TO on messages alone changes CHAR FK key collation and fails with
    // ER_FK_INCOMPATIBLE_COLUMNS against conversations.id. Skip when already
    // utf8mb4; otherwise convert parents first and match their collation.
    await ensureUtf8mb4('messages', 'conversations');
    await ensureUtf8mb4('hermes_message_chunks', 'messages');
  }
};
