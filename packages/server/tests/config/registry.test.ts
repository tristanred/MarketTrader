import { describe, it, expect } from 'vitest';
import {
  CONFIG_REGISTRY,
  descriptorFor,
  isConfigKey,
  isLiveKey,
  liveKeys,
  liveValueSchema,
} from '../../src/config/registry.js';
import { RuntimeConfig } from '../../src/config/runtime-config.js';

// That the registry covers exactly env + liveBootConfig — and marks each key
// with the right mutability — is enforced at compile time by its `satisfies`.

describe('CONFIG_REGISTRY', () => {
  it('never marks a secret as live', () => {
    for (const key of liveKeys()) expect(descriptorFor(key).secret ?? false, key).toBe(false);
  });

  it('bounds every live integer', () => {
    for (const key of liveKeys()) {
      const d = descriptorFor(key);
      if (d.kind !== 'integer' || d.mutability !== 'live') continue;
      expect(d.min, `${key}.min`).toBeTypeOf('number');
      expect(d.max, `${key}.max`).toBeTypeOf('number');
      expect(d.min!, key).toBeLessThanOrEqual(d.max!);
    }
  });

  it('gives every enum its options and every restart option a reason', () => {
    for (const key of Object.keys(CONFIG_REGISTRY)) {
      if (!isConfigKey(key)) throw new Error(key);
      const d = descriptorFor(key);
      if (d.kind === 'enum') expect(d.options?.length, key).toBeGreaterThan(0);
      if (d.mutability === 'restart') expect(d.restartReason.length, key).toBeGreaterThan(0);
    }
  });

  // GET /admin/config hides or masks values based on these flags alone, so an
  // option dropped from either set would leak in the response body.
  it('marks exactly the credential-bearing options secret or redacted', () => {
    const flagged = (flag: 'secret' | 'redactUrl') =>
      Object.keys(CONFIG_REGISTRY)
        .filter((key) => isConfigKey(key) && descriptorFor(key)[flag] === true)
        .sort();
    expect(flagged('secret')).toEqual(
      ['ALPACA_API_KEY_ID', 'ALPACA_API_SECRET_KEY', 'JWT_SECRET', 'OPENROUTER_API_KEY', 'POSTHOG_KEY'],
    );
    expect(flagged('redactUrl')).toEqual(
      ['DATABASE_URL', 'OTEL_EXPORTER_OTLP_ENDPOINT', 'POSTHOG_HOST'],
    );
  });

  // liveValueSchema's one cast relies on this: each live descriptor's kind must
  // describe the type env.ts actually parses for that key.
  it('declares a kind matching each live boot value', () => {
    const config = RuntimeConfig.fromEnvironment();
    for (const key of liveKeys()) {
      const d = descriptorFor(key);
      const value = config.bootValue(key);
      if (d.kind === 'integer') expect(Number.isInteger(value), key).toBe(true);
      if (d.kind === 'boolean') expect(typeof value, key).toBe('boolean');
      if (d.kind === 'enum') expect(d.options, key).toContain(value);
      if (d.kind === 'string') expect(typeof value, key).toBe('string');
    }
  });
});

describe('isConfigKey / isLiveKey', () => {
  it.each(['toString', '__proto__', 'constructor', 'hasOwnProperty', 'watchlist_max_items', 'NOPE', ''])(
    'rejects %j',
    (key) => {
      expect(isConfigKey(key)).toBe(false);
      expect(isLiveKey(key)).toBe(false);
    },
  );

  it('distinguishes live from restart keys', () => {
    expect(isLiveKey('WATCHLIST_MAX_ITEMS')).toBe(true);
    expect(isConfigKey('JWT_SECRET')).toBe(true);
    expect(isLiveKey('JWT_SECRET')).toBe(false);
  });
});

describe('liveValueSchema', () => {
  it('accepts only real booleans', () => {
    const schema = liveValueSchema('STOCK_ALLOW_STALE_TRADES');
    expect(schema.safeParse(true).success).toBe(true);
    expect(schema.safeParse('true').success).toBe(false);
  });

  it('bounds cache TTL overrides', () => {
    const schema = liveValueSchema('STOCK_CACHE_TTL_MS');
    expect(schema.safeParse(60_000).success).toBe(true);
    expect(schema.safeParse(1).success).toBe(false);
  });

  it('enforces integer bounds and JSON type', () => {
    const schema = liveValueSchema('WATCHLIST_MAX_ITEMS');
    expect(schema.safeParse(50).success).toBe(true);
    expect(schema.safeParse(0).success).toBe(false);
    expect(schema.safeParse(501).success).toBe(false);
    expect(schema.safeParse(1.5).success).toBe(false);
    expect(schema.safeParse('50').success).toBe(false);
  });

  it('restricts enums to their options', () => {
    const schema = liveValueSchema('MARKET_HOURS_MODE');
    expect(schema.safeParse('pending').success).toBe(true);
    expect(schema.safeParse('sometimes').success).toBe(false);
  });

  it('validates privileged CIDR overrides', () => {
    const schema = liveValueSchema('LIMITS_PRIVILEGED_CIDRS');
    expect(schema.safeParse('203.0.113.0/24, 2001:db8::/32, 198.51.100.7').success).toBe(true);
    expect(schema.safeParse('').success).toBe(true);
    expect(schema.safeParse('203.0.113.0/33').success).toBe(false);
    expect(schema.safeParse('office').success).toBe(false);
  });

  it('allows a zero maturity period but not a negative one', () => {
    const schema = liveValueSchema('LIMITS_MATURITY_DAYS');
    expect(schema.safeParse(0).success).toBe(true);
    expect(schema.safeParse(-1).success).toBe(false);
    expect(schema.safeParse(366).success).toBe(false);
  });
});
