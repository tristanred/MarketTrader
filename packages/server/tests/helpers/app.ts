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
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { unlinkSync } from 'fs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(__dir, '../../drizzle');

export async function createTestDb() {
  // libsql treats `:memory:` as per-connection, so tests must use a file-backed DB.
  // The file is created in the OS tmpdir and removed on process exit.
  const dbPath = path.join(tmpdir(), `markettrader-test-${randomBytes(8).toString('hex')}.db`);
  process.on('exit', () => { try { unlinkSync(dbPath); } catch { /* ignore */ } });
  const client = createClient({ url: `file:${dbPath}` });
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
