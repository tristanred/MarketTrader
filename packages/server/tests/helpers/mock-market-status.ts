import type { MarketStatusResult } from '@markettrader/shared';
import type { MarketStatusProvider } from '../../src/providers/market-status/interface.js';
import { StockProviderError } from '../../src/providers/index.js';

/** Configurable mock for {@link MarketStatusProvider} used in integration tests. */
export class MockMarketStatusProvider implements MarketStatusProvider {
  private result: MarketStatusResult = {
    state: 'REGULAR',
    asOf: new Date().toISOString(),
    source: 'static',
  };
  private error: StockProviderError | null = null;

  setResult(result: Partial<MarketStatusResult>): void {
    this.result = { ...this.result, ...result };
  }

  setError(code: 'PROVIDER_ERROR' | 'RATE_LIMITED'): void {
    this.error = new StockProviderError(code, `mock ${code}`);
  }

  async getStatus(): Promise<MarketStatusResult> {
    if (this.error) throw this.error;
    return this.result;
  }
}
