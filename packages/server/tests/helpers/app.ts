import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import * as schema from '../../src/db/schema.sqlite.js';
import { buildApp } from '../../src/app.js';
import type { FastifyInstance } from 'fastify';
import type { StockProvider } from '../../src/providers/index.js';
import type { MarketStatusProvider } from '../../src/providers/market-status/interface.js';
import { MockStockProvider } from './mock-provider.js';
import { MockMarketStatusProvider } from './mock-market-status.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(__dir, '../../drizzle/sqlite');

export async function createTestDb() {
  // `cache=shared` is the only in-memory URL form libsql exposes for cross-
  // connection sharing within one process. Without it, every pooled connection
  // sees its own empty DB. Vitest isolates files into separate workers, so
  // there's no cross-file bleed; multiple createTestDb() calls within a single
  // file do share state, which is fine as long as fixtures use unique IDs.
  const client = createClient({ url: 'file::memory:?cache=shared' });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  // Match production: enforce FKs so cascade/restrict actions fire in tests.
  await client.execute('PRAGMA foreign_keys = ON');
  return db;
}

export async function createTestApp(
  provider?: StockProvider,
  marketStatusProvider?: MarketStatusProvider,
): Promise<FastifyInstance> {
  return (await createTestAppWithDb(provider, marketStatusProvider)).app;
}

/**
 * Like {@link createTestApp} but also returns the backing `db`, for tests that
 * need to assert on or mutate persisted state directly (e.g. flipping
 * `users.disabled` to exercise the account kill-switch).
 */
export async function createTestAppWithDb(
  provider?: StockProvider,
  marketStatusProvider?: MarketStatusProvider,
): Promise<{ app: FastifyInstance; db: Awaited<ReturnType<typeof createTestDb>> }> {
  const db = await createTestDb();
  // Always disable the price poller in tests to prevent setInterval from
  // keeping the Vitest process alive after app.close().
  const app = await buildApp({
    logger: false,
    db,
    provider: provider ?? new MockStockProvider(),
    marketStatusProvider: marketStatusProvider ?? new MockMarketStatusProvider(),
    disablePoller: true,
    disableRateLimit: true,
    leaderboardThrottleMs: 0,
  });
  return { app, db };
}
