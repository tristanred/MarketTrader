import yahooFinance from 'yahoo-finance2';
import type { StockQuote, StockSearchResult } from '@markettrader/shared';
import type { StockProvider } from './interface.js';
import { StockProviderError } from './interface.js';

yahooFinance.setGlobalConfig({ validation: { logErrors: false } });

export class YahooProvider implements StockProvider {
  async getQuote(symbol: string): Promise<StockQuote> {
    let result;
    try {
      result = await yahooFinance.quote(symbol);
    } catch {
      throw new StockProviderError('PROVIDER_ERROR', `Yahoo Finance error for ${symbol}`);
    }

    if (!result || result.regularMarketPrice == null) {
      throw new StockProviderError('SYMBOL_NOT_FOUND', `Symbol not found: ${symbol}`);
    }

    return {
      symbol: result.symbol,
      price: result.regularMarketPrice,
      change: result.regularMarketChange ?? 0,
      changePercent: result.regularMarketChangePercent ?? 0,
      fetchedAt: new Date().toISOString(),
    };
  }

  async searchSymbols(query: string): Promise<StockSearchResult[]> {
    let result;
    try {
      result = await yahooFinance.search(query);
    } catch {
      return [];
    }

    return (result.quotes ?? [])
      .filter(
        (q): q is Extract<typeof q, { isYahooFinance: true; quoteType: string; symbol: string }> =>
          'isYahooFinance' in q &&
          q.isYahooFinance === true &&
          'quoteType' in q &&
          (q as { quoteType: string }).quoteType === 'EQUITY' &&
          'symbol' in q,
      )
      .map((q) => ({
        symbol: q.symbol,
        name: q.shortname ?? q.longname ?? q.symbol,
      }));
  }
}
