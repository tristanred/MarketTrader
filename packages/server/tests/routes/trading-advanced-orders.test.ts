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

async function createGame(
  app: FastifyInstance,
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/games',
    headers: { Authorization: `Bearer ${token}` },
    payload: {
      name: 'AdvOrders',
      startDate: '2020-01-01T00:00:00.000Z',
      endDate: '2099-01-01T00:00:00.000Z',
      startingBalance: 100000,
      allowLimitOrders: true,
      allowStopOrders: true,
      allowBracketOrders: true,
      allowGTC: true,
      ...overrides,
    },
  });
  return res.json<{ id: string }>().id;
}

describe('POST /games/:id/trades — limit order', () => {
  let app: FastifyInstance;
  let token: string;
  let gameId: string;
  let provider: MockStockProvider;

  beforeAll(async () => {
    provider = new MockStockProvider();
    provider.setQuote('AAPL', { price: 100 });
    app = await createTestApp(provider);
    ({ token } = await registerUser(app, 'adv-limit'));
    gameId = await createGame(app, token);
  });

  afterAll(async () => app.close());

  it('returns 202 with the resting order when placing a limit buy', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/games/${gameId}/trades`,
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        symbol: 'AAPL',
        direction: 'buy',
        quantity: 5,
        orderType: 'limit',
        timeInForce: 'gtc',
        limitPrice: 90,
      },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json<{ orders: Array<{ orderType: string; status?: string }> }>();
    expect(body.orders).toHaveLength(1);
    expect(body.orders[0]?.orderType).toBe('limit');
  });

  it('rejects with 422 when limitPrice is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/games/${gameId}/trades`,
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        symbol: 'AAPL',
        direction: 'buy',
        quantity: 1,
        orderType: 'limit',
      },
    });
    // Zod schema rejection — returns 400 or 422 depending on Fastify config.
    expect([400, 422]).toContain(res.statusCode);
  });

  it('lists working orders via GET /trades?status=working', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/games/${gameId}/trades?status=working`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<Array<{ orderType: string }>>();
    expect(body.length).toBeGreaterThan(0);
    expect(body[0]?.orderType).toBe('limit');
  });

  it('includes working buy reservedCash in portfolio totalValue', async () => {
    // The limit buy placed above reserved 5 * 90 = 450. The open order's
    // reservedCash must be added back so totalValue is unchanged from the
    // starting balance — a working buy must not look like a loss.
    const res = await app.inject({
      method: 'GET',
      url: `/games/${gameId}/portfolio`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      cashBalance: number;
      totalValue: number;
      reservedValue: number;
    }>();
    expect(body.reservedValue).toBe(450);
    // cashBalance + reservedValue === starting balance (no holdings yet).
    expect(body.cashBalance + body.reservedValue).toBe(body.totalValue);
  });
});

describe('POST /games/:id/trades — bracket order', () => {
  let app: FastifyInstance;
  let token: string;
  let gameId: string;

  beforeAll(async () => {
    const provider = new MockStockProvider();
    provider.setQuote('AAPL', { price: 100 });
    app = await createTestApp(provider);
    ({ token } = await registerUser(app, 'adv-bracket'));
    gameId = await createGame(app, token);
  });

  afterAll(async () => app.close());

  it('returns 202 with 3 rows when placing a bracket', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/games/${gameId}/trades`,
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        symbol: 'AAPL',
        direction: 'buy',
        quantity: 10,
        orderType: 'bracket',
        timeInForce: 'day',
        limitPrice: 100,
        takeProfitPrice: 120,
        stopLossPrice: 90,
      },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json<{ orders: Array<{ bracketRole: string | null }> }>();
    expect(body.orders).toHaveLength(3);
    const roles = body.orders.map((o) => o.bracketRole).sort();
    expect(roles).toEqual(['entry', 'stop_loss', 'take_profit']);
  });
});

describe('DELETE /games/:id/trades/:tradeId', () => {
  let app: FastifyInstance;
  let token: string;
  let gameId: string;

  beforeAll(async () => {
    const provider = new MockStockProvider();
    provider.setQuote('AAPL', { price: 100 });
    app = await createTestApp(provider);
    ({ token } = await registerUser(app, 'adv-cancel'));
    gameId = await createGame(app, token);
  });

  afterAll(async () => app.close());

  it('cancels a working order and refunds reservation', async () => {
    const place = await app.inject({
      method: 'POST',
      url: `/games/${gameId}/trades`,
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        symbol: 'AAPL',
        direction: 'buy',
        quantity: 5,
        orderType: 'limit',
        limitPrice: 100,
      },
    });
    const tradeId = place.json<{ orders: Array<{ id: string }> }>().orders[0]!.id;

    const del = await app.inject({
      method: 'DELETE',
      url: `/games/${gameId}/trades/${tradeId}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(del.statusCode).toBe(204);

    const list = await app.inject({
      method: 'GET',
      url: `/games/${gameId}/trades?status=working`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(list.json<unknown[]>()).toHaveLength(0);
  });

  it('returns 404 for an unknown tradeId', async () => {
    const del = await app.inject({
      method: 'DELETE',
      url: `/games/${gameId}/trades/does-not-exist`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(del.statusCode).toBe(404);
  });
});

describe('per-game order-type gates', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    const provider = new MockStockProvider();
    provider.setQuote('AAPL', { price: 100 });
    app = await createTestApp(provider);
    ({ token } = await registerUser(app, 'adv-gates'));
  });

  afterAll(async () => app.close());

  it('returns 409 LIMIT_ORDERS_DISABLED when allowLimitOrders is false', async () => {
    const gameId = await createGame(app, token, { allowLimitOrders: false });
    const res = await app.inject({
      method: 'POST',
      url: `/games/${gameId}/trades`,
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        symbol: 'AAPL',
        direction: 'buy',
        quantity: 1,
        orderType: 'limit',
        limitPrice: 100,
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ code: string }>().code).toBe('LIMIT_ORDERS_DISABLED');
  });

  it('returns 409 GTC_DISABLED when allowGTC is false', async () => {
    const gameId = await createGame(app, token, { allowGTC: false });
    const res = await app.inject({
      method: 'POST',
      url: `/games/${gameId}/trades`,
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        symbol: 'AAPL',
        direction: 'buy',
        quantity: 1,
        orderType: 'limit',
        timeInForce: 'gtc',
        limitPrice: 100,
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ code: string }>().code).toBe('GTC_DISABLED');
  });

  it('returns 409 BRACKET_ORDERS_DISABLED when allowBracketOrders is false', async () => {
    const gameId = await createGame(app, token, { allowBracketOrders: false });
    const res = await app.inject({
      method: 'POST',
      url: `/games/${gameId}/trades`,
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        symbol: 'AAPL',
        direction: 'buy',
        quantity: 1,
        orderType: 'bracket',
        limitPrice: 100,
        takeProfitPrice: 120,
        stopLossPrice: 90,
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ code: string }>().code).toBe('BRACKET_ORDERS_DISABLED');
  });
});
