import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { MockStockProvider } from '../helpers/mock-provider.js';
import { MockMarketStatusProvider } from '../helpers/mock-market-status.js';

async function registerUser(app: FastifyInstance, username: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { username, password: 'password123' },
  });
  const body = res.json<{ token: string; user: { id: string } }>();
  return { token: body.token, userId: body.user.id };
}

async function createActiveGame(app: FastifyInstance, token: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/games',
    headers: { Authorization: `Bearer ${token}` },
    payload: {
      name: 'g',
      startDate: '2020-01-01T00:00:00.000Z',
      endDate: '2099-01-01T00:00:00.000Z',
      startingBalance: 10000,
    },
  });
  return res.json<{ id: string }>();
}

// Mutate the cached env object so the route picks up the test mode without
// reloading the module.
async function setEnv(patch: Record<string, unknown>): Promise<() => Promise<void>> {
  const envModule = await import('../../src/env.js');
  const previous: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    previous[key] = (envModule.env as any)[key];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (envModule.env as any)[key] = patch[key];
  }
  return async () => {
    for (const key of Object.keys(previous)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (envModule.env as any)[key] = previous[key];
    }
  };
}

describe('POST /games/:id/trades — MARKET_HOURS_MODE=disabled', () => {
  let app: FastifyInstance;
  let token: string;
  let gameId: string;
  let restore: () => Promise<void>;
  let marketStatus: MockMarketStatusProvider;

  beforeAll(async () => {
    restore = await setEnv({ MARKET_HOURS_MODE: 'disabled' });
    const provider = new MockStockProvider();
    provider.setQuote('AAPL', { price: 100 });
    marketStatus = new MockMarketStatusProvider();
    marketStatus.setResult({ state: 'CLOSED' });
    app = await createTestApp(provider, marketStatus);
    ({ token } = await registerUser(app, 'trader-mhd'));
    ({ id: gameId } = await createActiveGame(app, token));
  });

  afterAll(async () => {
    await app.close();
    await restore();
  });

  it('returns 409 MARKET_CLOSED when market is closed', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/games/${gameId}/trades`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { symbol: 'AAPL', direction: 'buy', quantity: 1 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ code: string }>().code).toBe('MARKET_CLOSED');
  });

  it('fills normally when market is REGULAR', async () => {
    marketStatus.setResult({ state: 'REGULAR' });
    const res = await app.inject({
      method: 'POST',
      url: `/games/${gameId}/trades`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { symbol: 'AAPL', direction: 'buy', quantity: 1 },
    });
    expect(res.statusCode).toBe(201);
  });
});

describe('POST /games/:id/trades — MARKET_HOURS_MODE=pending', () => {
  let app: FastifyInstance;
  let token: string;
  let gameId: string;
  let restore: () => Promise<void>;
  let marketStatus: MockMarketStatusProvider;

  beforeAll(async () => {
    restore = await setEnv({ MARKET_HOURS_MODE: 'pending' });
    const provider = new MockStockProvider();
    provider.setQuote('AAPL', { price: 100 });
    marketStatus = new MockMarketStatusProvider();
    marketStatus.setResult({ state: 'CLOSED' });
    app = await createTestApp(provider, marketStatus);
    ({ token } = await registerUser(app, 'trader-mhp'));
    ({ id: gameId } = await createActiveGame(app, token));
  });

  afterAll(async () => {
    await app.close();
    await restore();
  });

  it('returns 202 with pending body and reserves cash', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/games/${gameId}/trades`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { symbol: 'AAPL', direction: 'buy', quantity: 3 },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json<{
      pending: { symbol: string; quantity: number; reservedPrice: number; reservedCash: number };
    }>();
    expect(body.pending.symbol).toBe('AAPL');
    expect(body.pending.quantity).toBe(3);
    expect(body.pending.reservedPrice).toBe(100);
    expect(body.pending.reservedCash).toBe(300);

    const portfolioRes = await app.inject({
      method: 'GET',
      url: `/games/${gameId}/portfolio`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(portfolioRes.json<{ cashBalance: number }>().cashBalance).toBe(9700);
  });

  it('lists pending orders via GET /games/:id/trades/pending', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/games/${gameId}/trades/pending`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<Array<{ symbol: string }>>();
    expect(body.length).toBeGreaterThan(0);
    expect(body[0]?.symbol).toBe('AAPL');
  });

  it('cancels a pending order, refunding cash', async () => {
    const list = await app.inject({
      method: 'GET',
      url: `/games/${gameId}/trades/pending`,
      headers: { Authorization: `Bearer ${token}` },
    });
    const pendingId = list.json<Array<{ id: string }>>()[0]?.id;
    if (!pendingId) throw new Error('no pending order to cancel');

    const del = await app.inject({
      method: 'DELETE',
      url: `/games/${gameId}/trades/pending/${pendingId}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(del.statusCode).toBe(204);

    const portfolioRes = await app.inject({
      method: 'GET',
      url: `/games/${gameId}/portfolio`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(portfolioRes.json<{ cashBalance: number }>().cashBalance).toBe(10000);
  });

  it('does not include pending rows in executed trade history', async () => {
    await app.inject({
      method: 'POST',
      url: `/games/${gameId}/trades`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { symbol: 'AAPL', direction: 'buy', quantity: 1 },
    });
    const history = await app.inject({
      method: 'GET',
      url: `/games/${gameId}/trades`,
      headers: { Authorization: `Bearer ${token}` },
    });
    const trades = history.json<unknown[]>();
    // Either empty or all executed — the pending row we just placed must not appear.
    for (const t of trades) {
      expect((t as { price: unknown }).price).not.toBeNull();
    }
  });
});

describe('MARKET_HOURS_INCLUDE_EXTENDED gates PRE/POST', () => {
  let app: FastifyInstance;
  let token: string;
  let gameId: string;
  let restore: () => Promise<void>;
  let marketStatus: MockMarketStatusProvider;

  beforeEach(async () => {
    restore = await setEnv({ MARKET_HOURS_MODE: 'disabled', MARKET_HOURS_INCLUDE_EXTENDED: true });
    const provider = new MockStockProvider();
    provider.setQuote('AAPL', { price: 100 });
    marketStatus = new MockMarketStatusProvider();
    marketStatus.setResult({ state: 'PRE' });
    app = await createTestApp(provider, marketStatus);
    ({ token } = await registerUser(app, `tr-ext-${Math.random().toString(36).slice(2, 8)}`));
    ({ id: gameId } = await createActiveGame(app, token));
  });

  afterAll(async () => {
    await restore?.();
  });

  it('allows trade during PRE when extended hours are enabled', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/games/${gameId}/trades`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { symbol: 'AAPL', direction: 'buy', quantity: 1 },
    });
    expect(res.statusCode).toBe(201);
    await app.close();
    await restore();
  });

  it('blocks trade during PRE when extended hours are disabled', async () => {
    await restore();
    restore = await setEnv({ MARKET_HOURS_MODE: 'disabled', MARKET_HOURS_INCLUDE_EXTENDED: false });
    const res = await app.inject({
      method: 'POST',
      url: `/games/${gameId}/trades`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { symbol: 'AAPL', direction: 'buy', quantity: 1 },
    });
    expect(res.statusCode).toBe(409);
    await app.close();
    await restore();
  });
});
