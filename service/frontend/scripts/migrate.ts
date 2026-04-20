import { runDatabaseMigrations } from '../src/lib/server/schema';

async function main() {
  const result = await runDatabaseMigrations();

  if (result.applied.length === 0) {
    console.log('Database schema is up to date.');
    return;
  }

  console.log(`Applied ${result.applied.length} migration(s):`);
  for (const migration of result.applied) {
    console.log(`- ${migration.id}: ${migration.description}`);
  }
}

main().catch((error) => {
  console.error('Database migration failed.');
  console.error(error);
  process.exit(1);
});