import { sql } from 'drizzle-orm';
import { db } from '../../../packages/server/src/db/index.js';
import { env } from '../../../packages/server/src/env.js';

/**
 * Sets `PRAGMA busy_timeout` on the libsql connection that the *immediately
 * following* db operation will adopt, then runs `fn`. This makes a contended
 * write (`BEGIN IMMEDIATE` for a transaction, or a single INSERT/DELETE) wait
 * for the lock instead of failing instantly with `SQLITE_BUSY` — which lets the
 * seed tool run while the API and its workers write the same file.
 *
 * Why not a one-time startup PRAGMA, and why not a retry?
 * - libsql opens a fresh connection after every transaction that resets
 *   `busy_timeout` to 0, so the value must be re-set before each operation.
 * - Retrying a `SQLITE_BUSY` failure on the shared client does NOT recover: a
 *   failed `BEGIN IMMEDIATE` leaves that connection unable to acquire the lock
 *   again (verified). Waiting via `busy_timeout` avoids the failure entirely.
 *
 * The PRAGMA reliably pins to `fn`'s connection because nothing between this
 * call and `fn`'s first statement nulls libsql's current connection (plain
 * selects/executes reuse it; only a transaction's BEGIN swaps it). Safe to call
 * before any single db operation; do not interleave unrelated db work between
 * the call and `fn`.
 *
 * No-op under PostgreSQL (MVCC has no busy-lock problem, and `db.run`/`PRAGMA`
 * don't apply there).
 */
export async function withBusyTimeout<T>(fn: () => Promise<T>): Promise<T> {
  if (!env.DATABASE_URL.startsWith('postgres')) {
    await db.run(sql`PRAGMA busy_timeout = ${sql.raw(String(env.SQLITE_BUSY_TIMEOUT_MS))}`);
  }
  return fn();
}
