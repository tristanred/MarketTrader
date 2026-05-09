import { env } from '../env.js';

// PG note: drizzle-orm/postgres-js maps decimal/numeric columns to string at runtime.
// Service code reading monetary columns (cashBalance, startingBalance, avgCostBasis, price)
// must parse them: Number(row.cashBalance) or parseFloat(row.price).
// SQLite real columns return number directly — types align at the application layer.
async function createDatabase() {
  if (env.DATABASE_URL.startsWith('postgres')) {
    const { drizzle } = await import('drizzle-orm/postgres-js');
    const postgres = (await import('postgres')).default;
    const schema = await import('./schema.pg.js');
    const client = postgres(env.DATABASE_URL);
    return drizzle(client, { schema });
  } else {
    const { drizzle } = await import('drizzle-orm/better-sqlite3');
    const Database = (await import('better-sqlite3')).default;
    const schema = await import('./schema.sqlite.js');
    const client = new Database(env.DATABASE_URL);
    return drizzle(client, { schema });
  }
}

export const db = await createDatabase();
export type Db = typeof db;
