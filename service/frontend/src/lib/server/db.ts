import mysql from 'mysql2/promise';
import { getConfig } from './env';

const config = getConfig();

export const pool = mysql.createPool({
  host: config.databaseHost,
  port: config.databasePort,
  user: config.databaseUser,
  password: config.databasePassword,
  database: config.databaseName,
  connectionLimit: 10,
  namedPlaceholders: true
});

export async function query<T>(sql: string, params: Record<string, unknown> = {}): Promise<T[]> {
  const [rows] = await pool.query(sql, params as any);
  return rows as T[];
}

export async function execute(sql: string, params: Record<string, unknown> = {}) {
  const [result] = await pool.execute(sql, params as any);
  return result;
}
