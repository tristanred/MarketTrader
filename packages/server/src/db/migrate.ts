import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../env.js';
import { db } from './index.js';

const __dir = path.dirname(fileURLToPath(import.meta.url));
// In dev: packages/server/src/db → ../../drizzle/{dialect}
// In dist: packages/server/dist/db → ../../drizzle/{dialect}
const migrationsRoot = path.resolve(__dir, '..', '..', 'drizzle');

/**
 * Runs pending Drizzle migrations against the active database. Idempotent —
 * the migrator records applied migrations in its own `__drizzle_migrations`
 * table and skips already-applied entries. Picks the migration folder
 * matching the configured dialect.
 *
 * Skipped when `DATABASE_URL` is `:memory:` (tests provide their own DB and
 * run `migrate` directly).
 */
export async function runMigrations(): Promise<void> {
  if (env.DATABASE_URL === ':memory:') return;

  if (env.DATABASE_URL.startsWith('postgres')) {
    const { migrate } = await import('drizzle-orm/postgres-js/migrator');
    await migrate(db as never, {
      migrationsFolder: path.join(migrationsRoot, 'pg'),
    });
  } else {
    const { migrate } = await import('drizzle-orm/libsql/migrator');
    await migrate(db, {
      migrationsFolder: path.join(migrationsRoot, 'sqlite'),
    });
  }
}
