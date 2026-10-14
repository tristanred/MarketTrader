import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type { AdminConfigEntry, AdminConfigResponse } from '@markettrader/shared';
import { createTestAppWithDb, registerAdmin, type createTestDb } from '../helpers/app.js';
import { env } from '../../src/env.js';
import { CONFIG_REGISTRY, descriptorFor, isLiveKey, type EnvKey } from '../../src/config/registry.js';
import { CONFIG_OVERRIDE_PREFIX } from '../../src/services/config-overrides.js';
import * as schema from '../../src/db/schema.sqlite.js';
import type { RuntimeConfig } from '../../src/config/runtime-config.js';

describe('/admin/config', () => {
  let app: FastifyInstance;
  let config: RuntimeConfig;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let admin: { authorization: string };
  let member: { authorization: string };

  beforeAll(async () => {
    ({ app, config, db } = await createTestAppWithDb());
    admin = { authorization: `Bearer ${(await registerAdmin(app, 'cfg-admin')).token}` };
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'cfg-member', password: 'password123' },
    });
    member = { authorization: `Bearer ${reg.json<{ token: string }>().token}` };
  });

  // Overrides persist in the file's shared in-memory DB, so remove them between tests.
  afterEach(async () => {
    for (const key of config.overriddenKeys()) {
      await app.inject({ method: 'DELETE', url: `/admin/config/${key}`, headers: admin });
    }
  });

  afterAll(async () => {
    await app.close();
  });

  const put = (key: string, value: unknown) =>
    app.inject({ method: 'PUT', url: `/admin/config/${key}`, headers: admin, payload: { value } });

  it('rejects unauthenticated (401) and non-admin (403) callers', async () => {
    expect((await app.inject({ method: 'GET', url: '/admin/config' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/admin/config', headers: member })).statusCode).toBe(403);
    expect(
      (await app.inject({ method: 'PUT', url: '/admin/config/WATCHLIST_MAX_ITEMS', headers: member, payload: { value: 5 } })).statusCode,
    ).toBe(403);
  });

  it('lists every option in registry order without leaking secrets', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/config', headers: admin });
    expect(res.statusCode).toBe(200);
    expect(res.json<AdminConfigResponse>().entries.map((e) => e.key)).toEqual(Object.keys(CONFIG_REGISTRY));
    const entries = res.json<AdminConfigResponse>().entries;
    const secretKeys = (Object.keys(CONFIG_REGISTRY) as EnvKey[]).filter((k) => descriptorFor(k).secret);
    expect(secretKeys).toEqual(expect.arrayContaining(['JWT_SECRET', 'ALPACA_API_KEY_ID', 'ALPACA_API_SECRET_KEY', 'POSTHOG_KEY']));
    for (const key of secretKeys) {
      expect(entries.find((e) => e.key === key)).toMatchObject({ secret: true, bootValue: null, effectiveValue: null });
      // Secrets are restart-only, so they live on `env`; an unset one is '' and has nothing to leak.
      const raw = isLiveKey(key) ? '' : String(env[key]);
      if (raw !== '') expect(res.body).not.toContain(raw);
    }
    expect(res.body).not.toContain(env.JWT_SECRET);
  });

  it('applies a live override immediately and reports its source', async () => {
    const res = await put('WATCHLIST_MAX_ITEMS', 12);
    expect(res.statusCode).toBe(200);
    expect(res.json<AdminConfigEntry>()).toMatchObject({ source: 'override', effectiveValue: 12 });
    expect(config.get('WATCHLIST_MAX_ITEMS')).toBe(12);
  });

  it.each([
    ['STOCK_CACHE_TTL_MS', 1],
    ['STOCK_CACHE_TTL_MS', 1.5],
    ['STOCK_CACHE_TTL_MS', '60000'],
    ['STOCK_ALLOW_STALE_TRADES', 'true'],
    ['MARKET_HOURS_MODE', 'sometimes'],
  ])('rejects %s = %j with 400 and changes nothing', async (key, value) => {
    const res = await put(key, value);
    expect(res.statusCode).toBe(400);
    expect(res.json<{ code: string }>().code).toBe('INVALID_CONFIG_VALUE');
    expect(config.overriddenKeys()).toEqual([]);

    // Straight from the table, not via GET, which could be answering from memory.
    const rows = await db
      .select()
      .from(schema.systemSettings)
      .where(eq(schema.systemSettings.key, CONFIG_OVERRIDE_PREFIX + key));
    expect(rows).toEqual([]);
    const entries = (await app.inject({ method: 'GET', url: '/admin/config', headers: admin }))
      .json<AdminConfigResponse>().entries;
    expect(entries.find((e) => e.key === key)!.override).toBeNull();
  });

  it.each(['PORT', 'JWT_SECRET', 'DATABASE_URL'])('refuses to override restart-only %s (409)', async (key) => {
    const res = await put(key, 'x');
    expect(res.statusCode).toBe(409);
    expect(res.json<{ code: string }>().code).toBe('CONFIG_NOT_LIVE');
  });

  it.each(['NOPE', 'toString', '__proto__', 'constructor', 'watchlist_max_items'])('answers 404 for %s', async (key) => {
    expect((await put(key, 1)).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/admin/config/${key}`, headers: admin })).statusCode).toBe(404);
  });

  it('DELETE restores the boot value', async () => {
    await put('WATCHLIST_MAX_ITEMS', 12);
    const res = await app.inject({ method: 'DELETE', url: '/admin/config/WATCHLIST_MAX_ITEMS', headers: admin });
    expect(res.statusCode).toBe(200);
    expect(res.json<AdminConfigEntry>()).toMatchObject({
      override: null,
      effectiveValue: config.bootValue('WATCHLIST_MAX_ITEMS'),
    });
    expect(config.get('WATCHLIST_MAX_ITEMS')).toBe(config.bootValue('WATCHLIST_MAX_ITEMS'));
  });

  it('an override reaches the feature it controls', async () => {
    await put('WATCHLIST_MAX_PER_USER', 1);
    const create = (name: string) =>
      app.inject({ method: 'POST', url: '/watchlists', headers: admin, payload: { name } });
    expect((await create('cfg-a')).statusCode).toBe(201);
    expect((await create('cfg-b')).statusCode).toBe(409);
  });

  it('persists across a rebuild, and so does a reset', async () => {
    await put('STOCK_SEARCH_CACHE_TTL_MS', 120_000);

    // A second app on the same (shared in-memory) database is a restart: it
    // starts from boot values and buildApp's load() restores the override.
    const second = await createTestAppWithDb();
    try {
      expect(second.config.get('STOCK_SEARCH_CACHE_TTL_MS')).toBe(120_000);
      const entries = (await second.app.inject({ method: 'GET', url: '/admin/config', headers: admin }))
        .json<AdminConfigResponse>().entries;
      expect(entries.find((e) => e.key === 'STOCK_SEARCH_CACHE_TTL_MS')!.override).toMatchObject({
        value: 120_000,
        updatedBy: 'cfg-admin',
      });
      await second.app.inject({ method: 'DELETE', url: '/admin/config/STOCK_SEARCH_CACHE_TTL_MS', headers: admin });
    } finally {
      await second.app.close();
    }

    const third = await createTestAppWithDb();
    try {
      expect(third.config.get('STOCK_SEARCH_CACHE_TTL_MS')).toBe(third.config.bootValue('STOCK_SEARCH_CACHE_TTL_MS'));
    } finally {
      await third.app.close();
    }
    // The DELETE went through the second app, so the first app's config still
    // holds the override in memory; drop it so later tests in this file start clean.
    config.clear('STOCK_SEARCH_CACHE_TTL_MS');
  });
});
