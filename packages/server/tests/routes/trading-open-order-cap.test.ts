import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { LimitExceededBody } from '@markettrader/shared';
import { createTestApp } from '../helpers/app.js';
import { MockStockProvider } from '../helpers/mock-provider.js';
import { MockMarketStatusProvider } from '../helpers/mock-market-status.js';
import { RuntimeConfig } from '../../src/config/runtime-config.js';

async function registerUser(app: FastifyInstance, username: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { username, password: 'password123' },
  });
  return res.json<{ token: string }>().token;
}

async function createGame(app: FastifyInstance, token: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/games',
    headers: { Authorization: `Bearer ${token}` },
    payload: {
      name: 'OpenOrderCap',
      startDate: '2020-01-01T00:00:00.000Z',
      endDate: '2099-01-01T00:00:00.000Z',
      startingBalance: 100000,
      allowLimitOrders: true,
      allowGTC: true,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ id: string }>().id;
}

function trade(
  app: FastifyInstance,
  token: string,
  gameId: string,
  payload: Record<string, unknown>,
) {
  return app.inject({
    method: 'POST',
    url: `/games/${gameId}/trades`,
    headers: { Authorization: `Bearer ${token}` },
    payload,
  });
}

const limitBuy = {
  symbol: 'AAPL',
  direction: 'buy',
  quantity: 1,
  orderType: 'limit',
  timeInForce: 'gtc',
  limitPrice: 90,
};
const marketBuy = { symbol: 'AAPL', direction: 'buy', quantity: 1 };

describe('POST /games/:id/trades — open-order cap over HTTP', () => {
  let app: FastifyInstance;
  let marketStatus: MockMarketStatusProvider;

  beforeAll(async () => {
    const provider = new MockStockProvider();
    provider.setQuote('AAPL', { price: 100 });
    marketStatus = new MockMarketStatusProvider();
    app = await createTestApp(provider, marketStatus, {
      limits: { disabled: false },
      runtimeConfig: RuntimeConfig.fromEnvironment({
        LIMIT_OPEN_ORDERS_PER_PLAYER: 2,
        LIMITS_PROBATION_PERCENT: 100,
        MARKET_HOURS_MODE: 'pending',
      }),
    });
  });
  afterAll(() => app.close());

  function expectOpenOrdersDenial(res: Awaited<ReturnType<typeof trade>>): void {
    expect(res.statusCode).toBe(409);
    expect(res.json<LimitExceededBody>()).toMatchObject({
      code: 'LIMIT_EXCEEDED',
      limit: 'openOrders',
      max: 2,
    });
  }

  it('answers 409 LIMIT_EXCEEDED once resting + pending orders reach the cap', async () => {
    const token = await registerUser(app, 'oo-http-mixed');
    const gameId = await createGame(app, token);

    marketStatus.setResult({ state: 'REGULAR' });
    expect((await trade(app, token, gameId, limitBuy)).statusCode).toBe(202);

    marketStatus.setResult({ state: 'CLOSED' });
    expect((await trade(app, token, gameId, marketBuy)).statusCode).toBe(202);

    // Both write paths must refuse: the pending reservation and the resting order.
    expectOpenOrdersDenial(await trade(app, token, gameId, marketBuy));
    marketStatus.setResult({ state: 'REGULAR' });
    expectOpenOrdersDenial(await trade(app, token, gameId, limitBuy));
  });

  it('still fills a market order immediately when the cap is reached', async () => {
    const token = await registerUser(app, 'oo-http-fill');
    const gameId = await createGame(app, token);

    marketStatus.setResult({ state: 'REGULAR' });
    expect((await trade(app, token, gameId, limitBuy)).statusCode).toBe(202);
    expect((await trade(app, token, gameId, limitBuy)).statusCode).toBe(202);
    expectOpenOrdersDenial(await trade(app, token, gameId, limitBuy));
    expect((await trade(app, token, gameId, marketBuy)).statusCode).toBe(201);
  });
});
