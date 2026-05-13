import type { MarketStatusResult } from '@markettrader/shared';
import type { StockProvider } from '../interface.js';
import type { MarketStatusProvider } from './interface.js';

const PROBE_SYMBOL = 'SPY';

/**
 * {@link MarketStatusProvider} that piggybacks on the configured Yahoo-backed
 * {@link StockProvider}. Calls `getQuote('SPY')` and forwards the upstream
 * `marketState`. Because the inner StockProvider is already wrapped in the
 * cache + rate-limit decorators, this adds at most one Yahoo call per cache
 * miss — typically zero, since SPY is usually already a held symbol.
 *
 * If the quote arrives without `marketState` (cache row from before this
 * feature, or a future provider that doesn't report it), defaults to CLOSED
 * to keep the chart conservative.
 */
export class YahooMarketStatus implements MarketStatusProvider {
  constructor(private readonly inner: StockProvider) {}

  async getStatus(): Promise<MarketStatusResult> {
    const quote = await this.inner.getQuote(PROBE_SYMBOL);
    return {
      state: quote.marketState ?? 'CLOSED',
      asOf: quote.fetchedAt,
      source: 'yahoo',
    };
  }
}
