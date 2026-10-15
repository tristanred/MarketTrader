import { describe, it, expect } from 'vitest';
import type { LimitBasis, LimitKey } from '@markettrader/shared';
import { RuntimeConfig } from '../../src/config/runtime-config.js';
import { LimitResolver, probationValue, type LimitSubject } from '../../src/limits/resolver.js';
import type { RequestAccount } from '../../src/limits/account.js';

const DAY = 86_400_000;
const account = (id: string, ageDays: number, isAdmin = false): RequestAccount => ({
  id,
  createdAt: new Date(Date.now() - ageDays * DAY).toISOString(),
  isAdmin,
});

const MATURE = account('mature', 30);
const FRESH = account('fresh', 1);
const ADMIN = account('admin', 1, true);
const OFFICE = '203.0.113.7';
const HOME = '198.51.100.9';

function stubOverrides(entries: Record<string, Partial<Record<LimitKey, number>>>) {
  return { get: async (userId: string, key: LimitKey) => entries[userId]?.[key] };
}

function makeConfig(extra: Partial<Parameters<typeof RuntimeConfig.fromEnvironment>[0]> = {}) {
  return RuntimeConfig.fromEnvironment({
    LIMITS_ENABLED: true,
    LIMITS_MATURITY_DAYS: 7,
    LIMITS_PROBATION_PERCENT: 25,
    LIMITS_PRIVILEGED_CIDRS: '203.0.113.0/24',
    LIMITS_PRIVILEGED_MULTIPLIER: 10,
    LIMIT_GAMES_CREATED_PER_WEEK: 10,
    LIMIT_REGISTRATIONS_PER_IP_PER_DAY: 5,
    ...extra,
  });
}

interface Row {
  name: string;
  subject: LimitSubject;
  key?: LimitKey;
  overrides?: Record<string, Partial<Record<LimitKey, number>>>;
  max: number | null;
  basis: LimitBasis;
  privileged: boolean;
  probation: boolean;
}

// The precedence in spec §3.2: disabled → admin → override → probation → privileged.
const MATRIX: Row[] = [
  { name: 'mature, ordinary IP → base', subject: { account: MATURE, ip: HOME }, max: 10, basis: 'base', privileged: false, probation: false },
  { name: 'mature, office IP → base ×10', subject: { account: MATURE, ip: OFFICE }, max: 100, basis: 'base', privileged: true, probation: false },
  { name: 'fresh, ordinary IP → probation', subject: { account: FRESH, ip: HOME }, max: 3, basis: 'probation', privileged: false, probation: true },
  { name: 'fresh, office IP → probation ×10', subject: { account: FRESH, ip: OFFICE }, max: 30, basis: 'probation', privileged: true, probation: true },
  { name: 'override wins and takes no multiplier', subject: { account: MATURE, ip: OFFICE }, overrides: { mature: { gamesCreated: 4 } }, max: 4, basis: 'override', privileged: false, probation: false },
  { name: 'override lifts probation', subject: { account: FRESH, ip: HOME }, overrides: { fresh: { gamesCreated: 50 } }, max: 50, basis: 'override', privileged: false, probation: false },
  { name: 'override for another key does not apply', subject: { account: FRESH, ip: HOME }, overrides: { fresh: { trades: 999 } }, max: 3, basis: 'probation', privileged: false, probation: true },
  { name: 'admin → unlimited', subject: { account: ADMIN, ip: HOME }, max: null, basis: 'admin', privileged: false, probation: false },
  { name: 'admin beats an override', subject: { account: ADMIN, ip: HOME }, overrides: { admin: { gamesCreated: 1 } }, max: null, basis: 'admin', privileged: false, probation: false },
  { name: 'anonymous → base', subject: { ip: HOME }, max: 10, basis: 'base', privileged: false, probation: false },
  { name: 'anonymous on IPv4-mapped office IP → ×10', subject: { ip: `::ffff:${OFFICE}` }, max: 100, basis: 'base', privileged: true, probation: false },
  { name: 'ip limit: no probation for a fresh account', subject: { account: FRESH, ip: HOME }, key: 'registrationsPerIp', max: 5, basis: 'base', privileged: false, probation: false },
  { name: 'ip limit: overrides ignored', subject: { account: MATURE, ip: HOME }, key: 'registrationsPerIp', overrides: { mature: { registrationsPerIp: 99 } }, max: 5, basis: 'base', privileged: false, probation: false },
  { name: 'ip limit: office IP ×10', subject: { ip: OFFICE }, key: 'registrationsPerIp', max: 50, basis: 'base', privileged: true, probation: false },
];

describe('LimitResolver.resolve', () => {
  it.each(MATRIX)('$name', async (row) => {
    const resolver = new LimitResolver(makeConfig(), stubOverrides(row.overrides ?? {}));
    const key = row.key ?? 'gamesCreated';
    expect(await resolver.resolve(row.subject, key)).toEqual({
      key,
      max: row.max,
      basis: row.basis,
      privileged: row.privileged,
      probation: row.probation,
    });
  });

  it('LIMITS_ENABLED=false lifts every limit, even for a fresh account', async () => {
    const resolver = new LimitResolver(makeConfig({ LIMITS_ENABLED: false }), stubOverrides({}));
    expect(await resolver.resolve({ account: FRESH, ip: HOME }, 'gamesCreated')).toMatchObject({ max: null, basis: 'disabled' });
  });

  it('opts.disabled (the test fixture) behaves like LIMITS_ENABLED=false', async () => {
    const resolver = new LimitResolver(makeConfig(), stubOverrides({}), { disabled: true });
    expect(await resolver.resolve({ account: FRESH, ip: HOME }, 'gamesCreated')).toMatchObject({ max: null, basis: 'disabled' });
    expect(resolver.isDisabled()).toBe(true);
  });

  it('reads every value live', async () => {
    const config = makeConfig();
    const resolver = new LimitResolver(config, stubOverrides({}));
    config.set('LIMIT_GAMES_CREATED_PER_WEEK', 20);
    config.set('LIMITS_PROBATION_PERCENT', 50);
    expect((await resolver.resolve({ account: FRESH, ip: HOME }, 'gamesCreated')).max).toBe(10);
  });

  it('resolveForUser never applies the privileged multiplier', async () => {
    const resolver = new LimitResolver(makeConfig(), stubOverrides({}));
    expect(await resolver.resolveForUser(MATURE, 'gamesCreated')).toMatchObject({ max: 10, privileged: false });
  });

  it('baseValue reads the catalogue config key', () => {
    const resolver = new LimitResolver(makeConfig(), stubOverrides({}));
    expect(resolver.baseValue('gamesCreated')).toBe(10);
    expect(resolver.baseValue('registrationsPerIp')).toBe(5);
  });
});

describe('probationValue', () => {
  it.each([
    [10, 25, 3],
    [50, 25, 13],
    [30, 25, 8],
    [60, 25, 15],
    [600, 25, 150],
    [1, 25, 1],
    [3, 1, 1],
    [7, 100, 7],
  ])('probationValue(%i, %i) = %i', (base, percent, expected) => {
    expect(probationValue(base, percent)).toBe(expected);
  });
});
