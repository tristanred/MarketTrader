import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestAppWithDb, registerAdmin } from '../helpers/app.js';
import { registerUser } from '../helpers/users.js';
import { RuntimeConfig } from '../../src/config/runtime-config.js';
import { UsageTracker } from '../../src/limits/usage-tracker.js';

const settle = () => new Promise((r) => setImmediate(r));

describe('usage hooks', () => {
  let app: FastifyInstance;
  let tracker: UsageTracker;

  beforeEach(async () => {
    tracker = new UsageTracker();
    ({ app } = await createTestAppWithDb(undefined, undefined, {
      limits: { disabled: false },
      usageTracker: tracker,
      runtimeConfig: RuntimeConfig.fromEnvironment({
        LIMITS_PROBATION_PERCENT: 100,
        LIMIT_API_REQUESTS_PER_MINUTE: 3,
        LIMIT_CODE_LOOKUPS_PER_MINUTE: 1,
        LIMIT_REGISTRATIONS_PER_IP_PER_DAY: 1000,
        WATCHLIST_MAX_PER_USER: 1,
      }),
    }));
  });

  afterEach(async () => {
    await app.close();
  });

  it('records authenticated requests against the user and the route pattern', async () => {
    const u = await registerUser(app, 'usage-user');
    await app.inject({ method: 'GET', url: '/watchlists', headers: u.headers });
    await settle();
    expect(tracker.snapshotView().requests).toContainEqual(
      expect.objectContaining({ subjectType: 'user', subjectId: u.userId, route: 'GET /watchlists', count: 1 }),
    );
  });

  it('records anonymous requests against the IP, and 404s as unmatched', async () => {
    await app.inject({ method: 'GET', url: '/market/status', remoteAddress: '203.0.113.9' });
    await app.inject({ method: 'GET', url: '/no-such-route', remoteAddress: '203.0.113.9' });
    await settle();
    const rows = tracker.snapshotView().requests.filter((r) => r.subjectId === '203.0.113.9');
    expect(rows.map((r) => r.route).sort()).toEqual(['* <unmatched>', 'GET /market/status']);
    expect(rows.every((r) => r.subjectType === 'ip')).toBe(true);
  });

  it('does not record health, version or docs probes', async () => {
    await app.inject({ method: 'GET', url: '/health' });
    await app.inject({ method: 'GET', url: '/version' });
    await app.inject({ method: 'GET', url: '/docs' });
    // Control: the hook is live in this app, so the absence below means something.
    await app.inject({ method: 'GET', url: '/market/status' });
    await settle();
    const routes = tracker.snapshotView().requests.map((r) => r.route);
    expect(routes).toContain('GET /market/status');
    expect(routes.some((r) => /\/(health|version|docs)(\/|$)/.test(r))).toBe(false);
  });

  it('refuses a user past the per-minute ceiling with a LIMIT_EXCEEDED 429', async () => {
    const u = await registerUser(app, 'usage-ceiling');
    for (let i = 0; i < 3; i++) {
      expect((await app.inject({ method: 'GET', url: '/watchlists', headers: u.headers })).statusCode).toBe(200);
    }
    const res = await app.inject({ method: 'GET', url: '/watchlists', headers: u.headers });
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBe('30');
    expect(res.json()).toMatchObject({ code: 'LIMIT_EXCEEDED', limit: 'apiRequests', max: 3 });
    expect(tracker.snapshotView().denials).toContainEqual(
      expect.objectContaining({ subjectType: 'user', subjectId: u.userId, limitKey: 'apiRequests', count: 1 }),
    );
  });

  it('never applies the ceiling to an admin', async () => {
    const admin = await registerAdmin(app, 'usage-admin');
    const headers = { Authorization: `Bearer ${admin.token}` };
    for (let i = 0; i < 6; i++) {
      expect((await app.inject({ method: 'GET', url: '/watchlists', headers })).statusCode).toBe(200);
    }
  });

  it('records a denial raised through the enforcer', async () => {
    const u = await registerUser(app, 'usage-enforcer');
    await app.inject({ method: 'POST', url: '/watchlists', headers: u.headers, payload: { name: 'one' } });
    const res = await app.inject({ method: 'POST', url: '/watchlists', headers: u.headers, payload: { name: 'two' } });
    expect(res.statusCode).toBe(409);
    expect(tracker.snapshotView().denials).toContainEqual(
      expect.objectContaining({ subjectId: u.userId, limitKey: 'watchlists' }),
    );
  });

  it('records a denial raised by the rate-limit plugin under its limit key', async () => {
    const u = await registerUser(app, 'usage-rate');
    await app.inject({ method: 'GET', url: '/games/by-code/ABCDEFGH', headers: u.headers });
    const res = await app.inject({ method: 'GET', url: '/games/by-code/ABCDEFGH', headers: u.headers });
    expect(res.statusCode).toBe(429);
    // Exactly once: onExceeded counts it, and the error the builder returns is
    // marked recorded so the error handler does not count it again.
    const rows = tracker
      .snapshotView()
      .denials.filter((d) => d.subjectId === u.userId && d.limitKey === 'codeLookups');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ subjectType: 'user', count: 1 });
  });
});
