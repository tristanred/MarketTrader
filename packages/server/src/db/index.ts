import { env } from '../env.js';
import { drizzle as drizzleSqlite, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as sqliteSchema from './schema.sqlite.js';

// PG note: drizzle-orm/postgres-js maps decimal/numeric columns to string at runtime.
// Service code reading monetary columns (cashBalance, startingBalance, avgCostBasis, price)
// must parse them: Number(row.cashBalance) or parseFloat(row.price).
// SQLite real columns return number directly — types align at the application layer.
//
// Typing note: db is typed as BetterSQLite3Database (SQLite) throughout.
// In production (PG), an `as unknown as` cast is used — column names are identical
// so the generated SQL is the same; only the decimal/string runtime difference applies.
type AppDb = BetterSQLite3Database<typeof sqliteSchema>;

async function createDatabase(): Promise<AppDb> {
  if (env.DATABASE_URL.startsWith('postgres')) {
    const { drizzle } = await import('drizzle-orm/postgres-js');
    const postgres = (await import('postgres')).default;
    const pgSchema = await import('./schema.pg.js');
    const client = postgres(env.DATABASE_URL);
    return drizzle(client, { schema: pgSchema }) as unknown as AppDb;
  } else {
    const Database = (await import('better-sqlite3')).default;
    const client = new Database(env.DATABASE_URL);
    return drizzleSqlite(client, { schema: sqliteSchema });
  }
}

export const db = await createDatabase();
export const schema = sqliteSchema;
export type Db = AppDb;
