import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { LimitExceededBody } from '@markettrader/shared';
import { buildApp } from '../../src/app.js';
import { createTestApp, createTestAppWithDb, createTestDb, registerAdmin } from '../helpers/app.js';
import { registerUser, ageAccount } from '../helpers/users.js';
import { MockStockProvider } from '../helpers/mock-provider.js';
import { MockMarketStatusProvider } from '../helpers/mock-market-status.js';
import { RuntimeConfig } from '../../src/config/runtime-config.js';

function lookup(app: FastifyInstance, token: string, remoteAddress?: string) {
  return app.inject({
    method: 'GET',
    url: '/games/by-code/NOSUCHCD',
    headers: { Authorization: `Bearer ${token}` },
    ...(remoteAddress ? { remoteAddress } : {}),
  });
}

describe('per-user rate limits', () => {
  let app: FastifyInstance;
  let config: RuntimeConfig;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let seq = 0;
  const fresh = (prefix: string) => `${prefix}-${++seq}`;

  beforeAll(async () => {
    // The fixture keeps disableRateLimit: true. The per-user configs must still
    // fire, because their route-level allowList replaces the fixture bypass.
    ({ app, db, config } = await createTestAppWithDb(undefined, undefined, {
      limits: { disabled: false },
      runtimeConfig: RuntimeConfig.fromEnvironment({
        LIMIT_CODE_LOOKUPS_PER_MINUTE: 2,
        LIMIT_ORDER_CANCELS_PER_MINUTE: 2,
        LIMITS_PROBATION_PERCENT: 100,
        LIMIT_REGISTRATIONS_PER_IP_PER_DAY: 1000,
      }),
    }));
  });
  afterAll(() => app.close());
  afterEach(() => {
    config.clearAll();
  });

  it('answers the request past the limit with a LimitExceededBody 429', async () => {
    const { token, userId } = await registerUser(app, fresh('lookup'));
    await ageAccount(db, userId, 365);
    expect((await lookup(app, token)).statusCode).toBe(404);
    expect((await lookup(app, token)).statusCode).toBe(404);

    const over = await lookup(app, token);
    expect(over.statusCode).toBe(429);
    const body = over.json<LimitExceededBody>();
    expect(body).toMatchObject({
      code: 'LIMIT_EXCEEDED',
      limit: 'codeLookups',
      max: 2,
      probation: false,
    });
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
    expect(over.headers['retry-after']).toBeDefined();
  });

  it('gives every user their own budget behind one shared IP', async () => {
    const a = await registerUser(app, fresh('shared-a'));
    const b = await registerUser(app, fresh('shared-b'));
    await lookup(app, a.token);
    await lookup(app, a.token);
    expect((await lookup(app, a.token)).statusCode).toBe(429);
    expect((await lookup(app, b.token)).statusCode).toBe(404);
  });

  it('exempts admins', async () => {
    const admin = await registerAdmin(app, fresh('rate-admin'));
    for (let i = 0; i < 5; i += 1) {
      expect((await lookup(app, admin.token)).statusCode).toBe(404);
    }
  });

  it('multiplies the budget on a privileged connection', async () => {
    config.set('LIMITS_PRIVILEGED_CIDRS', '203.0.113.0/24');
    config.set('LIMITS_PRIVILEGED_MULTIPLIER', 2);
    const { token } = await registerUser(app, fresh('office'));
    for (let i = 0; i < 4; i += 1) {
      expect((await lookup(app, token, '203.0.113.5')).statusCode).toBe(404);
    }
    const over = await lookup(app, token, '203.0.113.5');
    expect(over.statusCode).toBe(429);
    expect(over.json<LimitExceededBody>().max).toBe(4);
  });

  it('limits order cancels', async () => {
    const { token } = await registerUser(app, fresh('canceller'));
    const cancel = () =>
      app.inject({
        method: 'DELETE',
        url: '/games/no-such-game/trades/no-such-order',
        headers: { Authorization: `Bearer ${token}` },
      });
    expect((await cancel()).statusCode).toBe(404);
    expect((await cancel()).statusCode).toBe(404);
    const over = await cancel();
    expect(over.statusCode).toBe(429);
    expect(over.json<LimitExceededBody>().limit).toBe('orderCancels');
  });

  it('counts working-order and pending cancels against one budget', async () => {
    const { token } = await registerUser(app, fresh('two-route-canceller'));
    const cancel = (url: string) =>
      app.inject({ method: 'DELETE', url, headers: { Authorization: `Bearer ${token}` } });
    const working = '/games/no-such-game/trades/no-such-order';
    const pending = '/games/no-such-game/trades/pending/no-such-pending';

    expect((await cancel(working)).statusCode).toBe(404);
    expect((await cancel(pending)).statusCode).toBe(404);
    for (const url of [working, pending]) {
      const over = await cancel(url);
      expect(over.statusCode).toBe(429);
      expect(over.json<LimitExceededBody>()).toMatchObject({ limit: 'orderCancels', max: 2 });
    }
  });

  it('never fires under the default test fixture', async () => {
    const plain = await createTestApp();
    const { token } = await registerUser(plain, 'fixture-user');
    for (let i = 0; i < 30; i += 1) {
      expect((await lookup(plain, token)).statusCode).toBe(404);
    }
    await plain.close();
  });
});

describe('privileged multiplier on the per-IP layer', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({
      logger: false,
      db: await createTestDb(),
      provider: new MockStockProvider(),
      marketStatusProvider: new MockMarketStatusProvider(),
      disablePoller: true,
      disableRateLimit: false,
      limits: { disabled: false },
      loginThrottle: { disabled: true },
      leaderboardThrottleMs: 0,
      runtimeConfig: RuntimeConfig.fromEnvironment({
        LIMITS_PRIVILEGED_CIDRS: '203.0.113.0/24',
        LIMITS_PRIVILEGED_MULTIPLIER: 2,
      }),
    });
  });
  afterAll(() => app.close());

  const badLogin = (remoteAddress: string) =>
    app.inject({
      method: 'POST',
      url: '/auth/login',
      remoteAddress,
      payload: { username: 'no-such-user', password: 'wrong' },
    });

  it('lets an allowlisted address make multiplier × the login attempts', async () => {
    for (let i = 0; i < 10; i += 1) {
      expect((await badLogin('203.0.113.7')).statusCode).toBe(401);
    }
    expect((await badLogin('203.0.113.7')).statusCode).toBe(429);
  });

  it('keeps the original cap for everyone else', async () => {
    for (let i = 0; i < 5; i += 1) {
      expect((await badLogin('198.51.100.3')).statusCode).toBe(401);
    }
    expect((await badLogin('198.51.100.3')).statusCode).toBe(429);
  });
});
