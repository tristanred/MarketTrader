import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import * as schema from '../../src/db/schema.sqlite.js';
import { buildApp } from '../../src/app.js';
import type { FastifyInstance } from 'fastify';
import type { StockProvider } from '../../src/providers/index.js';
import { MockStockProvider } from './mock-provider.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(__dir, '../../drizzle');

export async function createTestDb() {
  // `cache=shared` is the only in-memory URL form libsql exposes for cross-
  // connection sharing within one process. Without it, every pooled connection
  // sees its own empty DB. Vitest isolates files into separate workers, so
  // there's no cross-file bleed; multiple createTestDb() calls within a single
  // file do share state, which is fine as long as fixtures use unique IDs.
  const client = createClient({ url: 'file::memory:?cache=shared' });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db;
}

export async function createTestApp(provider?: StockProvider): Promise<FastifyInstance> {
  const db = await createTestDb();
  // Always disable the price poller in tests to prevent setInterval from
  // keeping the Vitest process alive after app.close().
  return buildApp({ logger: false, db, provider: provider ?? new MockStockProvider(), disablePoller: true, leaderboardThrottleMs: 0 });
}
