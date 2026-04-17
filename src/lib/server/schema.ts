import type { Migration } from './migrations/helpers';
import { execute, query } from './migrations/helpers';
import { migration as baseSchemaMigration } from './migrations/001_base_schema';
import { migration as attachmentMessageLinkMigration } from './migrations/002_attachment_message_link';
import { migration as attachmentTableContractMigration } from './migrations/003_attachment_table_contract';

interface SchemaMigrationRow {
  id: string;
}

let schemaReadyPromise: Promise<void> | null = null;

const migrations: Migration[] = [
  baseSchemaMigration,
  attachmentMessageLinkMigration,
  attachmentTableContractMigration
];

async function runSchemaMigrations() {
  await execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id VARCHAR(128) PRIMARY KEY,
      description VARCHAR(255) NOT NULL DEFAULT '',
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const descriptionExistsRows = await query<{ count: number }>(
    `SELECT COUNT(*) AS count
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'schema_migrations'
       AND COLUMN_NAME = 'description'`
  );
  if ((descriptionExistsRows[0]?.count ?? 0) === 0) {
    await execute("ALTER TABLE schema_migrations ADD COLUMN description VARCHAR(255) NOT NULL DEFAULT '' AFTER id");
  }

  const appliedRows = await query<SchemaMigrationRow>('SELECT id FROM schema_migrations');
  const applied = new Set(appliedRows.map((row) => row.id));

  for (const migration of migrations) {
    if (applied.has(migration.id)) {
      continue;
    }

    await migration.up();
    await execute('INSERT INTO schema_migrations (id, description) VALUES (:id, :description)', {
      id: migration.id,
      description: migration.description
    });
  }
}

export function ensureDatabaseSchema() {
  if (!schemaReadyPromise) {
    schemaReadyPromise = runSchemaMigrations().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }

  return schemaReadyPromise;
}