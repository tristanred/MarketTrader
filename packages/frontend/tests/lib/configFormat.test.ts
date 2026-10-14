import { describe, it, expect } from 'vitest';
import type { AdminConfigEntry } from '@markettrader/shared';
import { formatConfigValue, formatMs, parseConfigDraft } from '@/lib/configFormat';

const base: AdminConfigEntry = {
  key: 'STOCK_CACHE_TTL_MS', envVars: ['STOCK_CACHE_TTL_MS'], category: 'stock-data',
  description: '', kind: 'integer', unit: 'ms', options: null, min: 1000, max: 3_600_000,
  mutability: 'live', restartReason: null, secret: false, isSet: true, source: 'default',
  bootValue: 60000, effectiveValue: 60000, override: null,
};

describe('formatMs', () => {
  it.each([[900, '900ms'], [1000, '1s'], [90_000, '1m 30s'], [3_600_000, '1h'], [86_400_000, '1d']])(
    '%i → %s',
    (ms, text) => expect(formatMs(ms)).toBe(text),
  );
});

describe('formatConfigValue', () => {
  it('appends a human duration to ms values', () => {
    expect(formatConfigValue(base, 300000)).toBe('300000 ms (5m)');
  });
  it('never renders a secret', () => {
    const secret = { ...base, kind: 'string' as const, unit: null, secret: true };
    expect(formatConfigValue(secret, null)).toBe('Set (hidden)');
    expect(formatConfigValue({ ...secret, isSet: false }, null)).toBe('Not set');
  });
  it('labels the empty string', () => {
    expect(formatConfigValue({ ...base, kind: 'string', unit: null }, '')).toBe('(empty)');
  });
});

describe('parseConfigDraft', () => {
  it('enforces integer form and bounds', () => {
    expect(parseConfigDraft(base, '5000')).toEqual({ ok: true, value: 5000 });
    expect(parseConfigDraft(base, '1.5').ok).toBe(false);
    expect(parseConfigDraft(base, '10').ok).toBe(false);
    expect(parseConfigDraft(base, '').ok).toBe(false);
  });
  it('maps boolean drafts', () => {
    expect(parseConfigDraft({ ...base, kind: 'boolean', unit: null }, 'false')).toEqual({ ok: true, value: false });
  });
  it('restricts enums to their options', () => {
    const e = { ...base, kind: 'enum' as const, unit: null, options: ['instant', 'pending'] };
    expect(parseConfigDraft(e, 'pending')).toEqual({ ok: true, value: 'pending' });
    expect(parseConfigDraft(e, 'nope').ok).toBe(false);
  });
});
