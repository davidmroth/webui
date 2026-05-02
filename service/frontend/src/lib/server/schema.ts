import type { Migration } from './migrations/helpers';
import { execute, query } from './migrations/helpers';
import { migration as baseSchemaMigration } from './migrations/001_base_schema';
import { migration as attachmentMessageLinkMigration } from './migrations/002_attachment_message_link';
import { migration as attachmentTableContractMigration } from './migrations/003_attachment_table_contract';
import { migration as llamacppParityMigration } from './migrations/004_llamacpp_parity';
import { migration as streamingSupportMigration } from './migrations/005_streaming_support';
import { migration as deliveryTracesMigration } from './migrations/006_delivery_traces';
import { migration as branchRootsMigration } from './migrations/007_branch_roots';
import { migration as messageUpdatedAtMigration } from './migrations/008_message_updated_at';
import { migration as pushSubscriptionsMigration } from './migrations/009_push_subscriptions';
import { migration as mobileResilientChatStateMigration } from './migrations/010_mobile_resilient_chat_state';
import { migration as hermesRunStatusBackfillMigration } from './migrations/011_backfill_hermes_run_status';

interface SchemaMigrationRow {
  id: string;
  description?: string;
  applied_at?: Date | string;
}

interface AppliedMigration {
  id: string;
  description: string;
}

interface MigrationResult {
  applied: AppliedMigration[];
}

export interface SchemaMigrationStatus {
  latestExpectedMigrationId: string | null;
  latestAppliedMigrationId: string | null;
  latestAppliedAt: string | null;
  appliedCount: number;
  expectedCount: number;
  pendingMigrationIds: string[];
  current: boolean;
}

let schemaReadyPromise: Promise<void> | null = null;

const migrations: Migration[] = [
  baseSchemaMigration,
  attachmentMessageLinkMigration,
  attachmentTableContractMigration,
  llamacppParityMigration,
  streamingSupportMigration,
  deliveryTracesMigration,
  branchRootsMigration,
  messageUpdatedAtMigration,
  pushSubscriptionsMigration,
  mobileResilientChatStateMigration,
  hermesRunStatusBackfillMigration
];

function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export async function runDatabaseMigrations(): Promise<MigrationResult> {
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
  const appliedNow: AppliedMigration[] = [];

  for (const migration of migrations) {
    if (applied.has(migration.id)) {
      continue;
    }

    await migration.up();
    await execute('INSERT INTO schema_migrations (id, description) VALUES (:id, :description)', {
      id: migration.id,
      description: migration.description
    });
    appliedNow.push({ id: migration.id, description: migration.description });
  }

  return { applied: appliedNow };
}

export async function getSchemaMigrationStatus(): Promise<SchemaMigrationStatus> {
  const expectedIds = migrations.map((migration) => migration.id);
  const expectedIdSet = new Set(expectedIds);
  const rows = await query<Required<SchemaMigrationRow>>(
    `SELECT id, description, applied_at
     FROM schema_migrations
     ORDER BY applied_at ASC, id ASC`
  );
  const appliedIds = rows.map((row) => row.id).filter((id) => expectedIdSet.has(id));
  const appliedIdSet = new Set(appliedIds);
  const pendingMigrationIds = expectedIds.filter((id) => !appliedIdSet.has(id));
  const latestAppliedRow = [...rows].reverse().find((row) => expectedIdSet.has(row.id)) ?? null;

  return {
    latestExpectedMigrationId: expectedIds[expectedIds.length - 1] ?? null,
    latestAppliedMigrationId: latestAppliedRow?.id ?? null,
    latestAppliedAt: toIsoString(latestAppliedRow?.applied_at),
    appliedCount: appliedIds.length,
    expectedCount: expectedIds.length,
    pendingMigrationIds,
    current: pendingMigrationIds.length === 0
  };
}

export function ensureDatabaseSchema() {
  if (!schemaReadyPromise) {
    schemaReadyPromise = runDatabaseMigrations().then(() => undefined).catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }

  return schemaReadyPromise;
}