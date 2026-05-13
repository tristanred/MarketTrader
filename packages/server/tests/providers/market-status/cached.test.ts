import { describe, expect, it } from 'vitest';
import { CachedMarketStatus } from '../../../src/providers/market-status/cached.js';
import type { MarketStatusProvider } from '../../../src/providers/market-status/interface.js';
import type { MarketStatusResult } from '@markettrader/shared';

class Counter implements MarketStatusProvider {
  calls = 0;
  next: MarketStatusResult = {
    state: 'REGULAR',
    asOf: new Date().toISOString(),
    source: 'static',
  };
  async getStatus(): Promise<MarketStatusResult> {
    this.calls += 1;
    return this.next;
  }
}

describe('CachedMarketStatus', () => {
  it('serves the second call from cache within TTL', async () => {
    const inner = new Counter();
    const cached = new CachedMarketStatus(inner, 5000);
    await cached.getStatus();
    await cached.getStatus();
    expect(inner.calls).toBe(1);
  });

  it('refreshes after TTL expires', async () => {
    const inner = new Counter();
    const cached = new CachedMarketStatus(inner, 1);
    await cached.getStatus();
    await new Promise((r) => setTimeout(r, 5));
    await cached.getStatus();
    expect(inner.calls).toBe(2);
  });
});
