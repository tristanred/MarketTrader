import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../env.js';
import { db } from './index.js';

const __dir = path.dirname(fileURLToPath(import.meta.url));

// The two layouts sit at different depths below the package root, so a single
// relative path can't serve both: tsx runs this file from src/db/, while the
// tsup build bundles the whole server into a flat dist/index.js (there is no
// dist/db/). Both must land on packages/server/drizzle.
const MIGRATIONS_ROOT_CANDIDATES = [
  path.resolve(__dir, '..', '..', 'drizzle'), // src/db/migrate.ts
  path.resolve(__dir, '..', 'drizzle'), // dist/index.js
];

/**
 * Locates the `drizzle/` directory holding the generated migrations, which
 * ships alongside the build rather than being bundled into it.
 *
 * Exported for tests. Throws with the candidates it tried, because the failure
 * this replaces surfaced as an opaque "Can't find meta/_journal.json".
 */
export function resolveMigrationsRoot(): string {
  const found = MIGRATIONS_ROOT_CANDIDATES.find((dir) => existsSync(dir));
  if (!found) {
    throw new Error(
      `Drizzle migrations directory not found. Looked in:\n  ${MIGRATIONS_ROOT_CANDIDATES.join('\n  ')}`,
    );
  }
  return found;
}

/**
 * Runs pending Drizzle migrations against the active database. Idempotent —
 * the migrator records applied migrations in its own `__drizzle_migrations`
 * table and skips already-applied entries. Picks the migration folder
 * matching the configured dialect.
 */
export async function runMigrations(): Promise<void> {
  const migrationsRoot = resolveMigrationsRoot();
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
