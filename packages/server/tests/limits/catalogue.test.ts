import { describe, it, expect } from 'vitest';
import { LIMIT_KEYS } from '@markettrader/shared';
import { LIMIT_CATALOGUE, isLimitKey } from '../../src/limits/catalogue.js';
import { descriptorFor, isLiveKey } from '../../src/config/registry.js';

// Completeness (one descriptor per LimitKey) is enforced at compile time by the
// catalogue's `satisfies`; these pin the invariants the type cannot express.
describe('LIMIT_CATALOGUE', () => {
  it('has exactly one entry per LimitKey', () => {
    expect(Object.keys(LIMIT_CATALOGUE).sort()).toEqual([...LIMIT_KEYS].sort());
  });

  it.each([...LIMIT_KEYS])(
    '%s is backed by a live integer option in the limits category',
    (key) => {
      const { configKey } = LIMIT_CATALOGUE[key];
      expect(isLiveKey(configKey), configKey).toBe(true);
      const d = descriptorFor(configKey);
      expect(d.category).toBe('limits');
      expect(d.kind).toBe('integer');
    },
  );

  it.each([...LIMIT_KEYS])('%s has a window consistent with its kind', (key) => {
    const d = LIMIT_CATALOGUE[key];
    if (d.kind === 'rate') expect(d.windowMs).toBe(60_000);
    if (d.kind === 'concurrent') expect(d.windowMs).toBeNull();
    if (d.kind === 'quota' || d.kind === 'ip') expect(d.windowMs).toBeGreaterThan(0);
  });

  // An ip limit has no user to be new or to carry an override.
  it('never applies probation or overrides to ip limits', () => {
    for (const key of LIMIT_KEYS) {
      const d = LIMIT_CATALOGUE[key];
      if (d.kind === 'ip') {
        expect(d.probation, key).toBe(false);
        expect(d.overridable, key).toBe(false);
      } else {
        expect(d.probation, key).toBe(true);
        expect(d.overridable, key).toBe(true);
      }
    }
  });

  it('isLimitKey rejects prototype names and unknown keys', () => {
    expect(isLimitKey('trades')).toBe(true);
    expect(isLimitKey('toString')).toBe(false);
    expect(isLimitKey('nope')).toBe(false);
  });
});
