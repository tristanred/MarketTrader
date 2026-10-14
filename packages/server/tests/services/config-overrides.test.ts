import { describe, it, expect, beforeEach, vi } from 'vitest';
import { and, eq, like } from 'drizzle-orm';
import { createTestDb } from '../helpers/app.js';
import * as schema from '../../src/db/schema.sqlite.js';
import { env } from '../../src/env.js';
import { RuntimeConfig } from '../../src/config/runtime-config.js';
import {
  CONFIG_OVERRIDE_PREFIX,
  ConfigOverridesService,
} from '../../src/services/config-overrides.js';

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

// Only the audit FK needs a real user row. If `users` gains another NOT NULL
// column without a default, add it here.
async function insertAdmin(db: TestDb, username: string): Promise<string> {
  const [row] = await db
    .insert(schema.users)
    .values({ username, passwordHash: 'x' })
    .returning({ id: schema.users.id });
  return row!.id;
}

describe('ConfigOverridesService', () => {
  let db: TestDb;
  let config: RuntimeConfig;
  let svc: ConfigOverridesService;

  beforeEach(async () => {
    db = await createTestDb();
    // The in-memory DB is shared across this file; start each test clean.
    await db.delete(schema.systemSettings).where(like(schema.systemSettings.key, `${CONFIG_OVERRIDE_PREFIX}%`));
    config = RuntimeConfig.fromEnvironment();
    svc = new ConfigOverridesService(db, config);
  });

  it('load() applies valid rows and skips invalid ones with a warning', async () => {
    const row = (key: string, value: string) => ({ key: `${CONFIG_OVERRIDE_PREFIX}${key}`, value });
    await db.insert(schema.systemSettings).values([
      row('WATCHLIST_MAX_PER_USER', JSON.stringify({ value: 7 })),
      row('NO_SUCH_KEY', JSON.stringify({ value: 1 })),
      row('JWT_SECRET', JSON.stringify({ value: 'x'.repeat(40) })),
      row('STOCK_CACHE_TTL_MS', 'not json'),
      row('WATCHLIST_MAX_ITEMS', JSON.stringify({ value: 0 })),
      row('STOCK_ALLOW_STALE_TRADES', JSON.stringify({ nope: true })),
    ]);
    config.set('PRICE_POLLER_MAX_SYMBOLS', 3); // not in the DB, so load() must drop it
    const warn = vi.fn();

    const applied = await svc.load({ warn });

    expect(applied).toEqual(['WATCHLIST_MAX_PER_USER']);
    expect(config.get('WATCHLIST_MAX_PER_USER')).toBe(7);
    expect(config.get('WATCHLIST_MAX_ITEMS')).toBe(config.bootValue('WATCHLIST_MAX_ITEMS'));
    expect(config.get('PRICE_POLLER_MAX_SYMBOLS')).toBe(config.bootValue('PRICE_POLLER_MAX_SYMBOLS'));
    expect(warn).toHaveBeenCalledTimes(5);
  });

  it('set() persists, audits, and applies; get() reports it with the admin username', async () => {
    const adminId = await insertAdmin(db, 'cfg-admin-set');

    const entry = await svc.set('WATCHLIST_MAX_ITEMS', 9, adminId);

    expect(entry).toMatchObject({ key: 'WATCHLIST_MAX_ITEMS', source: 'override', effectiveValue: 9 });
    expect(entry.override).toMatchObject({ value: 9, updatedBy: 'cfg-admin-set' });
    expect(entry.bootValue).toBe(config.bootValue('WATCHLIST_MAX_ITEMS'));
    expect(config.get('WATCHLIST_MAX_ITEMS')).toBe(9);

    // Filtered by actor: the shared in-memory DB keeps audit rows from other tests.
    const audit = await db
      .select()
      .from(schema.adminAuditLog)
      .where(and(eq(schema.adminAuditLog.action, 'system.config.override'), eq(schema.adminAuditLog.adminUserId, adminId)));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.targetId).toBe('WATCHLIST_MAX_ITEMS');
  });

  it('reset() removes the override, restores the boot value, and audits only real removals', async () => {
    const adminId = await insertAdmin(db, 'cfg-admin-reset');
    await svc.set('WATCHLIST_MAX_ITEMS', 9, adminId);

    const entry = await svc.reset('WATCHLIST_MAX_ITEMS', adminId);
    await svc.reset('WATCHLIST_MAX_ITEMS', adminId);

    expect(entry.override).toBeNull();
    expect(entry.source).not.toBe('override');
    expect(config.get('WATCHLIST_MAX_ITEMS')).toBe(config.bootValue('WATCHLIST_MAX_ITEMS'));
    const audit = await db
      .select()
      .from(schema.adminAuditLog)
      .where(and(eq(schema.adminAuditLog.action, 'system.config.reset'), eq(schema.adminAuditLog.adminUserId, adminId)));
    expect(audit).toHaveLength(1);
  });

  it('list() covers every option and never exposes a secret value', async () => {
    const entries = await svc.list();
    const jwt = entries.find((e) => e.key === 'JWT_SECRET')!;
    expect(jwt).toMatchObject({ secret: true, isSet: true, bootValue: null, effectiveValue: null });
    expect(JSON.stringify(entries)).not.toContain(env.JWT_SECRET);
    // No `source` assertion: whether PORT reads 'env' or 'default' depends on the shell running the suite.
    expect(entries.find((e) => e.key === 'PORT')).toMatchObject({ mutability: 'restart', override: null });
  });
});
