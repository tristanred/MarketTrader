import { describe, it, expect } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { withPrivilegedIp, rateDenialLabel } from '../../src/limits/rate.js';
import { RuntimeConfig } from '../../src/config/runtime-config.js';
import type { RequestAccount } from '../../src/limits/account.js';

function fakeRequest(ip: string, account?: RequestAccount): FastifyRequest {
  return {
    ip,
    account,
    method: 'POST',
    routeOptions: { url: '/auth/login' },
  } as unknown as FastifyRequest;
}

const member: RequestAccount = { id: 'u1', createdAt: '2020-01-01T00:00:00.000Z', isAdmin: false };
const admin: RequestAccount = { id: 'a1', createdAt: '2020-01-01T00:00:00.000Z', isAdmin: true };

describe('withPrivilegedIp', () => {
  const config = RuntimeConfig.fromEnvironment({
    LIMITS_PRIVILEGED_CIDRS: '203.0.113.0/24',
    LIMITS_PRIVILEGED_MULTIPLIER: 10,
  });
  const opts = withPrivilegedIp(config, { max: 5, timeWindow: '1 minute' });
  const max = opts.max as (req: FastifyRequest, key: string) => number;

  it('keeps the hard-coded value for an ordinary address', () => {
    expect(max(fakeRequest('198.51.100.4'), 'k')).toBe(5);
  });

  it('multiplies it for an allowlisted address', () => {
    expect(max(fakeRequest('203.0.113.9'), 'k')).toBe(50);
  });

  it('lifts it for an authenticated admin', () => {
    expect(max(fakeRequest('198.51.100.4', admin), 'k')).toBe(Number.MAX_SAFE_INTEGER);
    expect(max(fakeRequest('198.51.100.4', member), 'k')).toBe(5);
  });

  it('reads the allowlist per request, so a live change applies at once', () => {
    config.set('LIMITS_PRIVILEGED_MULTIPLIER', 2);
    expect(max(fakeRequest('203.0.113.9'), 'k')).toBe(10);
    config.clearAll();
  });

  it('keeps the original time window and adds no allowList', () => {
    expect(opts.timeWindow).toBe('1 minute');
    expect(opts.allowList).toBeUndefined();
  });
});

describe('rateDenialLabel', () => {
  it('names the route for a request no per-user limit resolved', () => {
    expect(rateDenialLabel(fakeRequest('198.51.100.4'))).toBe('ip:POST /auth/login');
  });
});
