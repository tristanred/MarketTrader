import { describe, it, expect, vi } from 'vitest';
import { RuntimeConfig } from '../../src/config/runtime-config.js';
import { LimitResolver, type LimitSubject } from '../../src/limits/resolver.js';
import { LimitEnforcer, secondsUntilWindowFrees } from '../../src/limits/enforce.js';
import { LimitExceededError } from '../../src/limits/errors.js';

const mature = { id: 'u1', createdAt: new Date(Date.now() - 30 * 86_400_000).toISOString(), isAdmin: false };
const admin = { ...mature, id: 'a1', isAdmin: true };
const subject: LimitSubject = { account: mature, ip: '198.51.100.1' };

function setup() {
  const config = RuntimeConfig.fromEnvironment({ LIMITS_ENABLED: true, LIMIT_ACTIVE_GAMES_OWNED: 2, LIMIT_GAMES_CREATED_PER_WEEK: 2 });
  const resolver = new LimitResolver(config, { get: async () => undefined });
  const recordDenial = vi.fn();
  return { enforcer: new LimitEnforcer(resolver, recordDenial), recordDenial };
}

describe('LimitEnforcer', () => {
  it('admits while usage is below the max', async () => {
    const { enforcer, recordDenial } = setup();
    await expect(enforcer.enforceFor(subject, 'activeGamesOwned', async () => 1)).resolves.toBeUndefined();
    expect(recordDenial).not.toHaveBeenCalled();
  });

  it('throws LimitExceededError at the max and records the denial', async () => {
    const { enforcer, recordDenial } = setup();
    const err = await enforcer.enforceFor(subject, 'activeGamesOwned', async () => 2).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LimitExceededError);
    expect((err as LimitExceededError).resolved).toMatchObject({ key: 'activeGamesOwned', max: 2, basis: 'base' });
    expect(recordDenial).toHaveBeenCalledWith(subject, 'activeGamesOwned');
    expect((err as LimitExceededError).recorded).toBe(true);
  });

  it('carries retryAfter from the option', async () => {
    const { enforcer } = setup();
    const err = await enforcer
      .enforceFor(subject, 'gamesCreated', async () => 2, { retryAfter: async () => 3600 })
      .catch((e: unknown) => e);
    expect((err as LimitExceededError).retryAfterSeconds).toBe(3600);
  });

  it('never counts for an admin', async () => {
    const { enforcer } = setup();
    const count = vi.fn(async () => 1_000);
    await enforcer.enforceFor({ account: admin, ip: '198.51.100.1' }, 'activeGamesOwned', count);
    expect(count).not.toHaveBeenCalled();
  });
});

describe('secondsUntilWindowFrees', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  it('is the time until the oldest counted row leaves the window, rounded up', () => {
    expect(secondsUntilWindowFrees('2026-10-14T11:00:00.000Z', 2 * 3_600_000, now)).toBe(3600);
    expect(secondsUntilWindowFrees('2026-10-14T11:00:00.500Z', 3_600_000, now)).toBe(1);
  });
  it('falls back to the whole window for an unparseable timestamp', () => {
    expect(secondsUntilWindowFrees('garbage', 3_600_000, now)).toBe(3600);
  });
  it('is at least 1 and undefined without a row', () => {
    expect(secondsUntilWindowFrees('2026-10-14T10:00:00.000Z', 3_600_000, now)).toBe(1);
    expect(secondsUntilWindowFrees(null, 3_600_000, now)).toBeUndefined();
  });
});
