import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { MockStockProvider } from '../helpers/mock-provider.js';

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
      name: 'Active Game',
      startDate: '2020-01-01T00:00:00.000Z',
      endDate: '2099-01-01T00:00:00.000Z',
      startingBalance: 10000,
    },
  });
  return res.json<{ id: string }>();
}

describe('POST /games/:id/trades', () => {
  let app: FastifyInstance;
  let token: string;
  let gameId: string;

  beforeAll(async () => {
    const provider = new MockStockProvider();
    provider.setQuote('AAPL', { price: 100 });
    app = await createTestApp(provider);
    ({ token } = await registerUser(app, 'trader1'));
    ({ id: gameId } = await createActiveGame(app, token));
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 201 and trade when buying a valid stock', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/games/${gameId}/trades`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { symbol: 'AAPL', direction: 'buy', quantity: 5 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{
      trade: { symbol: string; direction: string; quantity: number };
      cashBalance: number;
    }>();
    expect(body.trade.symbol).toBe('AAPL');
    expect(body.trade.direction).toBe('buy');
    expect(body.trade.quantity).toBe(5);
    expect(body.cashBalance).toBe(9500); // 10000 - 5*100
  });

  it('returns 422 when insufficient funds', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/games/${gameId}/trades`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { symbol: 'AAPL', direction: 'buy', quantity: 200 },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ code: string }>().code).toBe('INSUFFICIENT_FUNDS');
  });

  it('returns 422 when selling shares not owned', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/games/${gameId}/trades`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { symbol: 'MSFT', direction: 'sell', quantity: 1 },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ code: string }>().code).toBe('INSUFFICIENT_SHARES');
  });

  it('returns 400 for fractional quantity', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/games/${gameId}/trades`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { symbol: 'AAPL', direction: 'buy', quantity: 1.5 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 401 when not authenticated', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/games/${gameId}/trades`,
      payload: { symbol: 'AAPL', direction: 'buy', quantity: 1 },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 when game does not exist', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/games/nonexistent-id/trades',
      headers: { Authorization: `Bearer ${token}` },
      payload: { symbol: 'AAPL', direction: 'buy', quantity: 1 },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns the same 404 for a non-member as for a missing game (no enumeration)', async () => {
    // A non-member must not be able to distinguish an existing game from a
    // missing one — same status AND body — and must never reach the order-type
    // gates or status recompute that would leak the game's configuration.
    const { token: outsider } = await registerUser(app, 'outsider');
    const res = await app.inject({
      method: 'POST',
      url: `/games/${gameId}/trades`,
      headers: { Authorization: `Bearer ${outsider}` },
      payload: { symbol: 'AAPL', direction: 'buy', quantity: 1 },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: string }>().error).toBe('Game not found');
  });

  it('returns 409 when game is not active (pending)', async () => {
    const { token: t2 } = await registerUser(app, 'trader2');
    const pendingRes = await app.inject({
      method: 'POST',
      url: '/games',
      headers: { Authorization: `Bearer ${t2}` },
      payload: {
        name: 'Pending Game',
        startDate: '2099-01-01T00:00:00.000Z',
        endDate: '2099-06-01T00:00:00.000Z',
        startingBalance: 10000,
      },
    });
    const pendingGameId = pendingRes.json<{ id: string }>().id;
    const res = await app.inject({
      method: 'POST',
      url: `/games/${pendingGameId}/trades`,
      headers: { Authorization: `Bearer ${t2}` },
      payload: { symbol: 'AAPL', direction: 'buy', quantity: 1 },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('GET /games/:id/trades', () => {
  let app: FastifyInstance;
  let token: string;
  let gameId: string;

  beforeAll(async () => {
    const provider = new MockStockProvider();
    provider.setQuote('AAPL', { price: 100 });
    app = await createTestApp(provider);
    ({ token } = await registerUser(app, 'trader3'));
    ({ id: gameId } = await createActiveGame(app, token));
    await app.inject({
      method: 'POST',
      url: `/games/${gameId}/trades`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { symbol: 'AAPL', direction: 'buy', quantity: 3 },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with trade history', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/games/${gameId}/trades`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const trades = res.json<Array<{ symbol: string; direction: string }>>();
    expect(trades.length).toBeGreaterThan(0);
    expect(trades[0]?.symbol).toBe('AAPL');
  });

  it('returns 401 when not authenticated', async () => {
    const res = await app.inject({ method: 'GET', url: `/games/${gameId}/trades` });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /games/:id/portfolio', () => {
  let app: FastifyInstance;
  let token: string;
  let gameId: string;

  beforeAll(async () => {
    const provider = new MockStockProvider();
    provider.setQuote('AAPL', { price: 120 });
    app = await createTestApp(provider);
    ({ token } = await registerUser(app, 'trader4'));
    ({ id: gameId } = await createActiveGame(app, token));
    await app.inject({
      method: 'POST',
      url: `/games/${gameId}/trades`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { symbol: 'AAPL', direction: 'buy', quantity: 10 },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with portfolio including unrealized P&L', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/games/${gameId}/portfolio`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      cashBalance: number;
      holdings: Array<{
        symbol: string;
        quantity: number;
        avgCostBasis: number;
        currentPrice: number;
        marketValue: number;
        unrealizedPnL: number;
        unrealizedPnLPercent: number;
      }>;
      totalValue: number;
    }>();
    expect(body.cashBalance).toBe(8800); // 10000 - 10*120
    expect(body.holdings).toHaveLength(1);
    expect(body.holdings[0]?.symbol).toBe('AAPL');
    expect(body.holdings[0]?.quantity).toBe(10);
    expect(body.holdings[0]?.avgCostBasis).toBe(120);
    expect(body.holdings[0]?.currentPrice).toBe(120);
    expect(body.holdings[0]?.unrealizedPnL).toBe(0);
    expect(body.totalValue).toBeCloseTo(10000);
  });

  it('returns 401 when not authenticated', async () => {
    const res = await app.inject({ method: 'GET', url: `/games/${gameId}/portfolio` });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /games/:id/trades — provider failure modes', () => {
  let app: FastifyInstance;
  let token: string;
  let gameId: string;
  let provider: MockStockProvider;

  beforeAll(async () => {
    provider = new MockStockProvider();
    provider.setQuote('AAPL', { price: 100 });
    app = await createTestApp(provider);
    ({ token } = await registerUser(app, 'trader-rl'));
    ({ id: gameId } = await createActiveGame(app, token));
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 429 with Retry-After when the provider is rate-limited', async () => {
    provider.setError('AAPL', 'RATE_LIMITED');
    const res = await app.inject({
      method: 'POST',
      url: `/games/${gameId}/trades`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { symbol: 'AAPL', direction: 'buy', quantity: 1 },
    });
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
    expect(res.json<{ code: string }>().code).toBe('RATE_LIMITED');
    provider.clear();
    provider.setQuote('AAPL', { price: 100 });
  });

  it('returns 409 STALE_PRICE_BLOCKED when stale quotes are returned but stale trades are disabled', async () => {
    // STOCK_ALLOW_STALE_TRADES defaults to false; this test relies on that default.
    provider.setStale('AAPL', 60_000, { price: 100 });
    const res = await app.inject({
      method: 'POST',
      url: `/games/${gameId}/trades`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { symbol: 'AAPL', direction: 'buy', quantity: 1 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ code: string }>().code).toBe('STALE_PRICE_BLOCKED');
    provider.clear();
    provider.setQuote('AAPL', { price: 100 });
  });
});

describe('POST /games/:id/trades — stale trades allowed', () => {
  let app: FastifyInstance;
  let token: string;
  let gameId: string;
  let provider: MockStockProvider;
  const previousFlag = process.env['STOCK_ALLOW_STALE_TRADES'];

  beforeAll(async () => {
    process.env['STOCK_ALLOW_STALE_TRADES'] = 'true';
    const envModule = await import('../../src/env.js');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (envModule.env as any).STOCK_ALLOW_STALE_TRADES = true;
    provider = new MockStockProvider();
    provider.setStale('AAPL', 30_000, { price: 100 });
    app = await createTestApp(provider);
    ({ token } = await registerUser(app, 'trader-stale'));
    ({ id: gameId } = await createActiveGame(app, token));
  });

  afterAll(async () => {
    await app.close();
    const envModule = await import('../../src/env.js');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (envModule.env as any).STOCK_ALLOW_STALE_TRADES = false;
    if (previousFlag === undefined) delete process.env['STOCK_ALLOW_STALE_TRADES'];
    else process.env['STOCK_ALLOW_STALE_TRADES'] = previousFlag;
  });

  it('fills the trade and returns priceWasStale + priceAgeMs', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/games/${gameId}/trades`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { symbol: 'AAPL', direction: 'buy', quantity: 1 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ priceWasStale?: boolean; priceAgeMs?: number; trade: { price: number } }>();
    expect(body.priceWasStale).toBe(true);
    expect(body.priceAgeMs).toBeGreaterThanOrEqual(30_000);
    expect(body.trade.price).toBe(100);
  });

  it('rejects with STALE_PRICE_TOO_OLD when the cached row is past the cap', async () => {
    provider.clear();
    provider.setStale('AAPL', 10 * 60_000, { price: 100 }); // 10 min, max is 5 min default
    const res = await app.inject({
      method: 'POST',
      url: `/games/${gameId}/trades`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { symbol: 'AAPL', direction: 'buy', quantity: 1 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ code: string }>().code).toBe('STALE_PRICE_TOO_OLD');
  });
});
