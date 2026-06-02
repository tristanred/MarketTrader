import type {
  StockDetails,
  StockHistoryBar,
  StockHistoryRange,
  StockQuote,
  StockSearchResult,
} from '@markettrader/shared';
import type { StockProvider } from './interface.js';
import { StockProviderError } from './interface.js';

/**
 * Builds the Alpaca authentication headers. Alpaca requires BOTH the key ID
 * and the secret on every authenticated request; sending only the ID gets a
 * 401/403. Shared by {@link AlpacaProvider} and the market-status provider so
 * the auth contract lives in exactly one place.
 */
export function alpacaAuthHeaders(apiKeyId: string, apiSecretKey: string): Record<string, string> {
  return {
    'APCA-API-KEY-ID': apiKeyId,
    'APCA-API-SECRET-KEY': apiSecretKey,
    Accept: 'application/json',
  };
}

/**
 * {@link StockProvider} backed by the Alpaca Data API v2.
 * Requires `ALPACA_API_KEY_ID` + `ALPACA_API_SECRET_KEY` (`STOCK_PROVIDER=alpaca`).
 *
 * Known limitations:
 * - `getQuote` uses the `ask price` (ap) field from quotes/latest. Daily
 *   change is not available from this endpoint; change fields are always 0.
 * - `searchSymbols` is not implemented (always returns empty array).
 * See the TODO comments for upgrade paths.
 */
export class AlpacaProvider implements StockProvider {
  private readonly baseUrl = 'https://data.alpaca.markets/v2';
  private readonly tradingBaseUrl = 'https://api.alpaca.markets/v2';
  private readonly headers: Record<string, string>;

  constructor(apiKeyId: string, apiSecretKey: string) {
    this.headers = alpacaAuthHeaders(apiKeyId, apiSecretKey);
  }

  async getQuote(symbol: string): Promise<StockQuote> {
    const url = `${this.baseUrl}/stocks/${encodeURIComponent(symbol)}/quotes/latest`;
    const res = await fetch(url, {
      headers: this.headers,
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

  async getDetails(symbol: string): Promise<StockDetails> {
    const headers = this.headers;

    const snapshotUrl = `${this.baseUrl}/stocks/${encodeURIComponent(symbol)}/snapshot`;
    const assetsUrl = `${this.tradingBaseUrl}/assets/${encodeURIComponent(symbol)}`;

    const [snapshotRes, assetsRes] = await Promise.allSettled([
      fetch(snapshotUrl, { headers }),
      fetch(assetsUrl, { headers }),
    ]);

    if (snapshotRes.status === 'rejected') {
      throw new StockProviderError('PROVIDER_ERROR', `Alpaca snapshot fetch failed for ${symbol}`);
    }
    const sres = snapshotRes.value;
    if (sres.status === 404) {
      throw new StockProviderError('SYMBOL_NOT_FOUND', `Symbol not found: ${symbol}`);
    }
    if (sres.status === 429) {
      throw new StockProviderError('RATE_LIMITED', 'Alpaca rate limit exceeded');
    }
    if (!sres.ok) {
      throw new StockProviderError('PROVIDER_ERROR', `Alpaca snapshot error ${sres.status} for ${symbol}`);
    }

    interface SnapshotResponse {
      latestTrade?: { p?: number };
      dailyBar?: { c?: number; v?: number };
      prevDailyBar?: { c?: number };
    }
    const snapshot = (await sres.json()) as SnapshotResponse;

    const price = snapshot.latestTrade?.p ?? snapshot.dailyBar?.c;
    const previousClose = snapshot.prevDailyBar?.c;
    const dayVolume = snapshot.dailyBar?.v;

    const details: StockDetails = {
      symbol,
      fetchedAt: new Date().toISOString(),
    };
    if (typeof price === 'number' && price > 0) details.price = price;
    if (typeof previousClose === 'number' && previousClose > 0) {
      details.previousClose = previousClose;
      if (details.price !== undefined) {
        details.change = details.price - previousClose;
        details.changePercent = (details.change / previousClose) * 100;
      }
    }
    if (typeof dayVolume === 'number') details.dayVolume = dayVolume;

    // Assets call is best-effort — missing exchange/companyName is acceptable.
    if (assetsRes.status === 'fulfilled' && assetsRes.value.ok) {
      interface AssetResponse {
        name?: string;
        exchange?: string;
      }
      try {
        const asset = (await assetsRes.value.json()) as AssetResponse;
        if (typeof asset.name === 'string' && asset.name.length > 0) {
          details.companyName = asset.name;
        }
        if (typeof asset.exchange === 'string' && asset.exchange.length > 0) {
          details.exchange = asset.exchange;
        }
      } catch {
        // swallow — assets are decorative
      }
    }

    return details;
  }
}
