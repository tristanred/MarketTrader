import type { StockQuote, StockSearchResult } from '@markettrader/shared';
import type { StockProvider } from '../../src/providers/index.js';

export class MockStockProvider implements StockProvider {
  private quotes = new Map<string, StockQuote>();

  setQuote(symbol: string, quote: Partial<StockQuote> = {}): void {
    this.quotes.set(symbol, {
      symbol,
      price: 100,
      change: 0,
      changePercent: 0,
      fetchedAt: new Date().toISOString(),
      ...quote,
    });
  }

  async getQuote(symbol: string): Promise<StockQuote> {
    return (
      this.quotes.get(symbol) ?? {
        symbol,
        price: 100,
        change: 0,
        changePercent: 0,
        fetchedAt: new Date().toISOString(),
      }
    );
  }

  async searchSymbols(query: string): Promise<StockSearchResult[]> {
    return [{ symbol: query.toUpperCase(), name: `Mock ${query}` }];
  }
}
