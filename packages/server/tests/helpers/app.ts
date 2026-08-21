import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import * as schema from '../../src/db/schema.sqlite.js';
import { ADMIN_GROUP_ID } from '../../src/constants/groups.js';
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
    // Same reasoning as disableRateLimit: shared fixtures make repeated bad-password
    // calls that would otherwise trip the per-account throttle. Tests that exercise
    // it build their own app.
    loginThrottle: { disabled: true },
    leaderboardThrottleMs: 0,
  });
  return { app, db };
}

let promotionDb: Awaited<ReturnType<typeof createTestDb>> | undefined;

/**
 * Registers a user through `POST /auth/register` and then adds it to the
 * `admin` group directly.
 *
 * The register route grants no group membership to anyone, and the boot-time
 * seed in `src/db/seed-admin.ts` deliberately does not run under tests, so this
 * is how a test obtains an administrator. Membership is read from the database
 * on every request, so the token issued at register works unchanged afterwards.
 */
export async function registerAdmin(
  app: FastifyInstance,
  username: string,
  password = 'password123',
): Promise<{ token: string; refreshToken: string; userId: string; username: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { username, password },
  });
  if (res.statusCode !== 201) {
    throw new Error(`registerAdmin: register failed: ${res.statusCode} ${res.body}`);
  }
  const body = res.json<{ token: string; user: { id: string; username: string } }>();

  // Every handle opened here points at the same shared in-memory database, so
  // this works whether the caller built its app with createTestApp or its own db.
  promotionDb ??= await createTestDb();
  await promotionDb
    .insert(schema.userGroups)
    .values({ userId: body.user.id, groupId: ADMIN_GROUP_ID });

  return {
    token: body.token,
    refreshToken: res.cookies.find((c) => c.name === 'refreshToken')?.value ?? '',
    userId: body.user.id,
    username: body.user.username,
  };
}
