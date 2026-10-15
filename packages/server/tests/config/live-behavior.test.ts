import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestAppWithDb } from '../helpers/app.js';
import { MockStockProvider } from '../helpers/mock-provider.js';
import { MockMarketStatusProvider } from '../helpers/mock-market-status.js';
import { RuntimeConfig } from '../../src/config/runtime-config.js';

describe('live options reach their consumers', () => {
  let app: FastifyInstance;
  let config: RuntimeConfig;
  let token: string;

  beforeAll(async () => {
    // The watchlist cap is a per-user limit now, so it only applies with limits on;
    // probation at 100% keeps a fresh account on the configured value.
    ({ app, config } = await createTestAppWithDb(undefined, undefined, {
      limits: { disabled: false },
      runtimeConfig: RuntimeConfig.fromEnvironment({ LIMITS_PROBATION_PERCENT: 100 }),
    }));
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'live-watchlist', password: 'password123' },
    });
    token = res.json<{ token: string }>().token;
  });

  afterAll(async () => {
    await app.close();
  });

  const create = (name: string) =>
    app.inject({
      method: 'POST',
      url: '/watchlists',
      headers: { authorization: `Bearer ${token}` },
      payload: { name },
    });

  it('WATCHLIST_MAX_PER_USER applies to the next create, and clearing restores it', async () => {
    expect((await create('first')).statusCode).toBe(201);

    config.set('WATCHLIST_MAX_PER_USER', 1);
    const blocked = await create('second');
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json<{ error: string }>().error).toContain('(1 per user)');

    config.clear('WATCHLIST_MAX_PER_USER');
    expect((await create('second')).statusCode).toBe(201);
  });
});

describe('STOCK_ALLOW_STALE_TRADES override', () => {
  let app: FastifyInstance;
  let config: RuntimeConfig;
  let token: string;
  let gameId: string;

  beforeAll(async () => {
    const provider = new MockStockProvider();
    provider.setStale('AAPL', 30_000, { price: 100 });
    ({ app, config } = await createTestAppWithDb(provider));
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'live-stale', password: 'password123' },
    });
    token = reg.json<{ token: string }>().token;
    gameId = (
      await app.inject({
        method: 'POST',
        url: '/games',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          name: 'g',
          startDate: '2020-01-01T00:00:00.000Z',
          endDate: '2099-01-01T00:00:00.000Z',
          startingBalance: 10000,
        },
      })
    ).json<{ id: string }>().id;
  });

  afterAll(async () => {
    await app.close();
  });

  const buy = () =>
    app.inject({
      method: 'POST',
      url: `/games/${gameId}/trades`,
      headers: { authorization: `Bearer ${token}` },
      payload: { symbol: 'AAPL', direction: 'buy', quantity: 1 },
    });

  it('switches between blocking and filling stale-priced trades without a restart', async () => {
    expect((await buy()).json<{ code: string }>().code).toBe('STALE_PRICE_BLOCKED');
    config.set('STOCK_ALLOW_STALE_TRADES', true);
    expect((await buy()).statusCode).toBe(201);
  });
});

describe('MARKET_HOURS_MODE override', () => {
  let app: FastifyInstance;
  let config: RuntimeConfig;
  let token: string;
  let gameId: string;

  beforeAll(async () => {
    const provider = new MockStockProvider();
    provider.setQuote('AAPL', { price: 100 });
    const marketStatus = new MockMarketStatusProvider();
    marketStatus.setResult({ state: 'CLOSED' });
    ({ app, config } = await createTestAppWithDb(provider, marketStatus, {
      runtimeConfig: RuntimeConfig.fromEnvironment({ MARKET_HOURS_MODE: 'instant' }),
    }));
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'live-mode', password: 'password123' },
    });
    token = reg.json<{ token: string }>().token;
    gameId = (
      await app.inject({
        method: 'POST',
        url: '/games',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          name: 'g',
          startDate: '2020-01-01T00:00:00.000Z',
          endDate: '2099-01-01T00:00:00.000Z',
          startingBalance: 10000,
        },
      })
    ).json<{ id: string }>().id;
  });

  afterAll(async () => {
    await app.close();
  });

  const buy = () =>
    app.inject({
      method: 'POST',
      url: `/games/${gameId}/trades`,
      headers: { authorization: `Bearer ${token}` },
      payload: { symbol: 'AAPL', direction: 'buy', quantity: 1 },
    });

  it('switches closed-market behavior without a restart', async () => {
    expect((await buy()).statusCode).toBe(201);
    config.set('MARKET_HOURS_MODE', 'disabled');
    const rejected = await buy();
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json<{ code: string }>().code).toBe('MARKET_CLOSED');
  });
});
