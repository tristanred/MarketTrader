import { describe, it, expect } from 'vitest';
import { RuntimeConfig } from '../../src/config/runtime-config.js';
import {
  isMatureUser,
  isPrivilegedConnection,
  maturityEndsAt,
  parseCidrList,
  validateCidrList,
} from '../../src/limits/policy.js';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-14T12:00:00.000Z');
const createdDaysAgo = (days: number) => ({ createdAt: new Date(NOW - days * DAY).toISOString() });

describe('validateCidrList', () => {
  it.each(['', '  ', '203.0.113.0/24', '203.0.113.0/24, 198.51.100.7', '2001:db8::/32', '::1'])(
    'accepts %j',
    (raw) => {
      expect(validateCidrList(raw)).toBeUndefined();
    },
  );

  it.each([
    ['10.0.0.0/33', '10.0.0.0/33'],
    ['office', 'office'],
    ['203.0.113.0/24, nope', 'nope'],
    ['2001:db8::/129', '2001:db8::/129'],
  ])('rejects %j naming the bad entry', (raw, bad) => {
    expect(validateCidrList(raw)).toContain(bad);
  });
});

describe('parseCidrList', () => {
  const list = parseCidrList('203.0.113.0/24, 198.51.100.7, 2001:db8::/32');

  it('matches addresses inside a v4 subnet and an exact address', () => {
    expect(list.matches('203.0.113.42')).toBe(true);
    expect(list.matches('198.51.100.7')).toBe(true);
    expect(list.size).toBe(3);
  });

  it('does not match outside the list', () => {
    expect(list.matches('203.0.114.1')).toBe(false);
    expect(list.matches('198.51.100.8')).toBe(false);
  });

  it('matches IPv4-mapped IPv6 addresses, which is how dual-stack sockets report v4 peers', () => {
    expect(list.matches('::ffff:203.0.113.9')).toBe(true);
  });

  it('matches inside a v6 subnet', () => {
    expect(list.matches('2001:db8:1::5')).toBe(true);
    expect(list.matches('2001:db9::1')).toBe(false);
  });

  it('never matches a non-address', () => {
    expect(list.matches('')).toBe(false);
    expect(list.matches('not-an-ip')).toBe(false);
  });

  it('matches nothing when empty', () => {
    expect(parseCidrList('').matches('203.0.113.1')).toBe(false);
  });

  it('memoises on the raw string', () => {
    expect(parseCidrList('10.0.0.0/8')).toBe(parseCidrList('10.0.0.0/8'));
  });
});

describe('isMatureUser', () => {
  const config = RuntimeConfig.fromEnvironment({ LIMITS_MATURITY_DAYS: 7 });

  it('is false inside the maturity period and true after it', () => {
    expect(isMatureUser(createdDaysAgo(6), config, NOW)).toBe(false);
    expect(isMatureUser(createdDaysAgo(8), config, NOW)).toBe(true);
  });

  it('is true exactly at the boundary', () => {
    expect(isMatureUser(createdDaysAgo(7), config, NOW)).toBe(true);
  });

  it('treats every account as mature when the period is 0', () => {
    const zero = RuntimeConfig.fromEnvironment({ LIMITS_MATURITY_DAYS: 0 });
    expect(isMatureUser(createdDaysAgo(0), zero, NOW)).toBe(true);
  });

  // Fail toward probation: an unreadable timestamp must not hand out full limits.
  it('treats an unparseable createdAt as not mature', () => {
    expect(isMatureUser({ createdAt: 'garbage' }, config, NOW)).toBe(false);
  });

  it('reads the period live', () => {
    const live = RuntimeConfig.fromEnvironment({ LIMITS_MATURITY_DAYS: 7 });
    expect(isMatureUser(createdDaysAgo(3), live, NOW)).toBe(false);
    live.set('LIMITS_MATURITY_DAYS', 2);
    expect(isMatureUser(createdDaysAgo(3), live, NOW)).toBe(true);
  });

  it('maturityEndsAt is createdAt plus the period', () => {
    expect(maturityEndsAt(createdDaysAgo(3), config).toISOString()).toBe(
      new Date(NOW + 4 * DAY).toISOString(),
    );
  });
});

describe('isPrivilegedConnection', () => {
  it('reads LIMITS_PRIVILEGED_CIDRS live', () => {
    const config = RuntimeConfig.fromEnvironment({ LIMITS_PRIVILEGED_CIDRS: '' });
    expect(isPrivilegedConnection('203.0.113.5', config)).toBe(false);
    config.set('LIMITS_PRIVILEGED_CIDRS', '203.0.113.0/24');
    expect(isPrivilegedConnection('203.0.113.5', config)).toBe(true);
  });
});
