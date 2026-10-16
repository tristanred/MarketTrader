import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Watchlist } from '@markettrader/shared';
import { createTestAppWithDb } from '../helpers/app.js';
import { RuntimeConfig } from '../../src/config/runtime-config.js';

async function registerUser(app: FastifyInstance, username: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { username, password: 'password123' },
  });
  return res.json<{ token: string }>().token;
}

function addItem(app: FastifyInstance, token: string, listId: string, symbol: string) {
  return app.inject({
    method: 'POST',
    url: `/watchlists/${listId}/items`,
    headers: { Authorization: `Bearer ${token}` },
    payload: { symbol },
  });
}

describe('F18 — watchlist growth is bounded', () => {
  let app: FastifyInstance;
  let config: RuntimeConfig;
  let token: string;

  beforeAll(async () => {
    ({ app, config } = await createTestAppWithDb(undefined, undefined, {
      limits: { disabled: false },
      runtimeConfig: RuntimeConfig.fromEnvironment({ LIMITS_PROBATION_PERCENT: 100 }),
    }));
    token = await registerUser(app, 'f18-capped');
  });
  afterAll(() => app.close());

  it('rejects a symbol past WATCHLIST_MAX_ITEMS with an explanatory 409', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/watchlists',
      headers: { Authorization: `Bearer ${token}` },
      payload: { name: 'ItemCap' },
    });
    const list = created.json<Watchlist>();

    for (let i = 0; i < config.get('WATCHLIST_MAX_ITEMS'); i += 1) {
      const res = await addItem(app, token, list.id, `SYM${i}`);
      expect(res.statusCode).toBe(200);
    }

    const overflow = await addItem(app, token, list.id, 'ONEMORE');
    expect(overflow.statusCode).toBe(409);
    expect(overflow.json<{ code: string; limit: string }>()).toMatchObject({
      code: 'LIMIT_EXCEEDED',
      limit: 'watchlistItems',
    });
    expect(overflow.json<{ error: string }>().error).toContain(String(config.get('WATCHLIST_MAX_ITEMS')));

    // A full list must stay usable: re-adding an existing symbol is still the
    // documented idempotent no-op, not a rejection.
    const repeat = await addItem(app, token, list.id, 'SYM0');
    expect(repeat.statusCode).toBe(200);
    expect(repeat.json<Watchlist>().symbols.length).toBe(config.get('WATCHLIST_MAX_ITEMS'));
  });

  it('rejects a watchlist past WATCHLIST_MAX_PER_USER but still serves existing names', async () => {
    const listToken = await registerUser(app, 'f18-list-capped');

    for (let i = 0; i < config.get('WATCHLIST_MAX_PER_USER'); i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/watchlists',
        headers: { Authorization: `Bearer ${listToken}` },
        payload: { name: `List ${i}` },
      });
      expect(res.statusCode).toBe(201);
    }

    const overflow = await app.inject({
      method: 'POST',
      url: '/watchlists',
      headers: { Authorization: `Bearer ${listToken}` },
      payload: { name: 'One Too Many' },
    });
    expect(overflow.statusCode).toBe(409);
    expect(overflow.json<{ code: string; limit: string }>()).toMatchObject({
      code: 'LIMIT_EXCEEDED',
      limit: 'watchlists',
    });
    expect(overflow.json<{ error: string }>().error).toContain(
      String(config.get('WATCHLIST_MAX_PER_USER')),
    );

    // The idempotent-by-name lookup must keep working at the cap.
    const existing = await app.inject({
      method: 'POST',
      url: '/watchlists',
      headers: { Authorization: `Bearer ${listToken}` },
      payload: { name: 'List 0' },
    });
    expect(existing.statusCode).toBe(200);
    expect(existing.json<Watchlist>().name).toBe('List 0');
  });
});
