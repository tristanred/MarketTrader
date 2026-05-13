import type {
  StockHistoryBar,
  StockHistoryRange,
  StockQuote,
  StockSearchResult,
} from '@markettrader/shared';
import type { StockProvider } from './interface.js';
import { StockProviderError } from './interface.js';

/**
 * {@link StockProvider} backed by the Alpaca Data API v2.
 * Requires `ALPACA_API_KEY` env var (`STOCK_PROVIDER=alpaca`).
 *
 * Known limitations:
 * - `getQuote` uses the `ask price` (ap) field from quotes/latest. Daily
 *   change is not available from this endpoint; change fields are always 0.
 * - `searchSymbols` is not implemented (always returns empty array).
 * See the TODO comments for upgrade paths.
 */
export class AlpacaProvider implements StockProvider {
  private readonly baseUrl = 'https://data.alpaca.markets/v2';

  constructor(private readonly apiKey: string) {}

  async getQuote(symbol: string): Promise<StockQuote> {
    const url = `${this.baseUrl}/stocks/${encodeURIComponent(symbol)}/quotes/latest`;
    const res = await fetch(url, {
      headers: {
        'APCA-API-KEY-ID': this.apiKey,
        Accept: 'application/json',
      },
    });

    if (res.status === 404) {
      throw new StockProviderError('SYMBOL_NOT_FOUND', `Symbol not found: ${symbol}`);
    }
    if (res.status === 429) {
      throw new StockProviderError('RATE_LIMITED', 'Alpaca rate limit exceeded');
    }
    if (!res.ok) {
      throw new StockProviderError('PROVIDER_ERROR', `Alpaca error ${res.status} for ${symbol}`);
    }

    const data = (await res.json()) as { quote?: { ap?: number } };
    const price = data.quote?.ap;
    if (price == null || price <= 0) {
      // ap is 0 when markets are closed or no current ask exists; treat as no data
      throw new StockProviderError('SYMBOL_NOT_FOUND', `No quote data for ${symbol}`);
    }

    return {
      symbol,
      price,
      // TODO(alpaca-change): Alpaca quotes/latest does not return daily change; would need prev-close from bars API
      change: 0,
      changePercent: 0,
      fetchedAt: new Date().toISOString(),
    };
  }

  // TODO(alpaca-search): Alpaca Assets API (GET /v2/assets?status=active) can implement symbol search
  async searchSymbols(_query: string): Promise<StockSearchResult[]> {
    return [];
  }

  // TODO(alpaca-history): wire to /v2/stocks/{symbol}/bars with timeframe + start derived from range.
  async getHistory(_symbol: string, _range: StockHistoryRange): Promise<StockHistoryBar[]> {
    throw new StockProviderError('PROVIDER_ERROR', 'Alpaca history is not implemented yet');
  }
}
