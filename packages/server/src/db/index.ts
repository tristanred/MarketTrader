import { env } from '../env.js';
import { drizzle as drizzleLibsql, type LibSQLDatabase } from 'drizzle-orm/libsql';
import * as sqliteSchema from './schema.sqlite.js';

// PG note: drizzle-orm/postgres-js maps decimal/numeric columns to string at runtime.
// Service code reading monetary columns (cashBalance, startingBalance, avgCostBasis, price)
// must parse them: Number(row.cashBalance) or parseFloat(row.price).
// SQLite real columns return number directly — types align at the application layer.
//
// Typing note: db is typed as LibSQLDatabase (SQLite via libsql) throughout.
// In production (PG), an `as unknown as` cast is used — column names are identical
// so the generated SQL is the same; only the decimal/string runtime difference applies.
type AppDb = LibSQLDatabase<typeof sqliteSchema>;

function normalizeLibsqlUrl(url: string): string {
  if (url === ':memory:') return url;
  if (url.startsWith('file:') || url.startsWith('libsql:') || url.startsWith('http:') || url.startsWith('https:') || url.startsWith('ws:') || url.startsWith('wss:')) {
    return url;
  }
  return `file:${url}`;
}

async function createDatabase(): Promise<AppDb> {
  if (env.DATABASE_URL.startsWith('postgres')) {
    const { drizzle } = await import('drizzle-orm/postgres-js');
    const postgres = (await import('postgres')).default;
    const pgSchema = await import('./schema.pg.js');
    const client = postgres(env.DATABASE_URL);
    return drizzle(client, { schema: pgSchema }) as unknown as AppDb;
  } else {
    const { createClient } = await import('@libsql/client');
    const client = createClient({ url: normalizeLibsqlUrl(env.DATABASE_URL) });
    return drizzleLibsql(client, { schema: sqliteSchema });
  }
}

export const db = await createDatabase();
// SQLite schema — used for Drizzle type inference only; see schema.pg.ts for PG migrations
export const schema = sqliteSchema;
export type Db = AppDb;
