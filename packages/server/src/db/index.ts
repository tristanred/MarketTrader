import { env } from '../env.js';

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
