import { describe, it, expect } from 'vitest';
import { RuntimeConfig } from '../../src/config/runtime-config.js';

describe('RuntimeConfig', () => {
  it('serves boot values until overridden, and again after clear', () => {
    const config = RuntimeConfig.fromEnvironment({ WATCHLIST_MAX_ITEMS: 50 });
    expect(config.get('WATCHLIST_MAX_ITEMS')).toBe(50);
    config.set('WATCHLIST_MAX_ITEMS', 3);
    expect(config.get('WATCHLIST_MAX_ITEMS')).toBe(3);
    expect(config.bootValue('WATCHLIST_MAX_ITEMS')).toBe(50);
    expect(config.overriddenKeys()).toEqual(['WATCHLIST_MAX_ITEMS']);
    config.clear('WATCHLIST_MAX_ITEMS');
    expect(config.get('WATCHLIST_MAX_ITEMS')).toBe(50);
    expect(config.overriddenKeys()).toEqual([]);
  });

  it('clearAll restores every boot value', () => {
    const config = RuntimeConfig.fromEnvironment({ WATCHLIST_MAX_ITEMS: 50, WATCHLIST_MAX_PER_USER: 20 });
    config.set('WATCHLIST_MAX_ITEMS', 3);
    config.set('WATCHLIST_MAX_PER_USER', 2);
    config.clearAll();
    expect(config.get('WATCHLIST_MAX_ITEMS')).toBe(50);
    expect(config.get('WATCHLIST_MAX_PER_USER')).toBe(20);
    expect(config.overriddenKeys()).toEqual([]);
  });

  it('keeps instances independent', () => {
    const a = RuntimeConfig.fromEnvironment();
    const b = RuntimeConfig.fromEnvironment();
    a.set('WATCHLIST_MAX_ITEMS', 3);
    expect(b.get('WATCHLIST_MAX_ITEMS')).toBe(b.bootValue('WATCHLIST_MAX_ITEMS'));
    expect(b.overriddenKeys()).toEqual([]);
  });
});
