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

// Captured at module load so graceful shutdown can close the underlying
// connection cleanly. Either `pgClient` or `libsqlClient` is set, never both.
let pgClient: { end: () => Promise<void> } | null = null;
let libsqlClient: { close: () => void } | null = null;

async function createDatabase(): Promise<AppDb> {
  if (env.DATABASE_URL.startsWith('postgres')) {
    const { drizzle } = await import('drizzle-orm/postgres-js');
    const postgres = (await import('postgres')).default;
    const pgSchema = await import('./schema.pg.js');
    const client = postgres(env.DATABASE_URL);
    pgClient = client;
    return drizzle(client, { schema: pgSchema }) as unknown as AppDb;
  } else {
    const { createClient } = await import('@libsql/client');
    const client = createClient({ url: normalizeLibsqlUrl(env.DATABASE_URL) });
    libsqlClient = client;
    return drizzleLibsql(client, { schema: sqliteSchema });
  }
}

export const db = await createDatabase();
// SQLite schema — used for Drizzle type inference only; see schema.pg.ts for PG migrations
export const schema = sqliteSchema;
export type Db = AppDb;

/**
 * Closes the underlying database client captured at startup. Safe to call
 * multiple times; subsequent calls are no-ops. Invoked from the graceful
 * shutdown handler in `src/index.ts`.
 */
export async function closeDb(): Promise<void> {
  if (pgClient) {
    const client = pgClient;
    pgClient = null;
    await client.end();
    return;
  }
  if (libsqlClient) {
    const client = libsqlClient;
    libsqlClient = null;
    client.close();
  }
}
