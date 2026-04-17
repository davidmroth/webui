import { execute, query } from '../db';

export interface Migration {
  id: string;
  description: string;
  up: () => Promise<void>;
}

export async function columnExists(tableName: string, columnName: string) {
  const rows = await query<{ count: number }>(
    `SELECT COUNT(*) AS count
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = :table_name
       AND COLUMN_NAME = :column_name`,
    { table_name: tableName, column_name: columnName }
  );
  return (rows[0]?.count ?? 0) > 0;
}

export async function indexExists(tableName: string, indexName: string) {
  const rows = await query<{ count: number }>(
    `SELECT COUNT(*) AS count
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = :table_name
       AND INDEX_NAME = :index_name`,
    { table_name: tableName, index_name: indexName }
  );
  return (rows[0]?.count ?? 0) > 0;
}

export async function foreignKeyExists(tableName: string, constraintName: string) {
  const rows = await query<{ count: number }>(
    `SELECT COUNT(*) AS count
     FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = :table_name
       AND CONSTRAINT_NAME = :constraint_name
       AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
    { table_name: tableName, constraint_name: constraintName }
  );
  return (rows[0]?.count ?? 0) > 0;
}

export { execute, query };