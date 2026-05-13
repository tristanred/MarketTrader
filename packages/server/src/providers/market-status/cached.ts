import type { MarketStatusResult } from '@markettrader/shared';
import type { MarketStatusProvider } from './interface.js';

/**
 * In-memory single-slot cache for {@link MarketStatusProvider.getStatus}.
 * Sessions change at well-known clock boundaries, so even a small TTL (the
 * default 60s) absorbs the polling traffic without losing meaningful precision.
 */
export class CachedMarketStatus implements MarketStatusProvider {
  private cached: { result: MarketStatusResult; fetchedAt: number } | null = null;

  constructor(
    private readonly inner: MarketStatusProvider,
    private readonly ttlMs: number,
  ) {}

  async getStatus(): Promise<MarketStatusResult> {
    if (this.cached && Date.now() - this.cached.fetchedAt < this.ttlMs) {
      return this.cached.result;
    }
    const result = await this.inner.getStatus();
    this.cached = { result, fetchedAt: Date.now() };
    return result;
  }
}
