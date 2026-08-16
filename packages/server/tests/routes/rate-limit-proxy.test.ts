import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { createTestDb } from '../helpers/app.js';
import { MockStockProvider } from '../helpers/mock-provider.js';
import { MockMarketStatusProvider } from '../helpers/mock-market-status.js';

// The shared helper forces `disableRateLimit: true`, so these build their own app.
async function buildAppWithTrust(trustProxy: boolean | string): Promise<FastifyInstance> {
  return buildApp({
    logger: false,
    db: await createTestDb(),
    provider: new MockStockProvider(),
    marketStatusProvider: new MockMarketStatusProvider(),
    disablePoller: true,
    disableRateLimit: false,
    leaderboardThrottleMs: 0,
    trustProxy,
  });
}

/**
 * One login attempt carrying a forged leftmost hop. `203.0.113.7` stands in for
 * the real peer address a reverse proxy appends on the right.
 */
function spoofedLogin(app: FastifyInstance, n: number) {
  return app.inject({
    method: 'POST',
    url: '/auth/login',
    headers: { 'x-forwarded-for': `9.9.9.${n}, 203.0.113.7` },
    payload: { username: 'no-such-user', password: 'wrong' },
  });
}

const LOGIN_CAP = 5; // routes/auth.ts

describe('rate limiting under a forged X-Forwarded-For', () => {
  describe("trustProxy: 'loopback' (the shipped configuration)", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = await buildAppWithTrust('loopback');
    });

    afterAll(async () => {
      await app.close();
    });

    it('keeps every forged request in the same bucket and enforces the cap', async () => {
      const statuses: number[] = [];
      const remaining: (string | undefined)[] = [];

      for (let n = 1; n <= LOGIN_CAP + 1; n++) {
        const res = await spoofedLogin(app, n);
        statuses.push(res.statusCode);
        remaining.push(res.headers['x-ratelimit-remaining'] as string | undefined);
      }

      // Five 401s, then the limiter fires despite a different leftmost hop each time.
      expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
      // A single draining bucket, not six fresh ones.
      expect(remaining.slice(0, LOGIN_CAP)).toEqual(['4', '3', '2', '1', '0']);
    });
  });

  describe('trustProxy: true (finding F1 — kept as a guard against regressing)', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = await buildAppWithTrust(true);
    });

    afterAll(async () => {
      await app.close();
    });

    it('hands out a fresh bucket per forged hop, so the cap never fires', async () => {
      const statuses: number[] = [];
      const remaining: (string | undefined)[] = [];

      for (let n = 1; n <= LOGIN_CAP + 1; n++) {
        const res = await spoofedLogin(app, n);
        statuses.push(res.statusCode);
        remaining.push(res.headers['x-ratelimit-remaining'] as string | undefined);
      }

      // This is the bypass: unlimited credential guessing at 5-per-minute nominal.
      expect(statuses.every((s) => s === 401)).toBe(true);
      expect(remaining.every((r) => r === '4')).toBe(true);
    });
  });
});
