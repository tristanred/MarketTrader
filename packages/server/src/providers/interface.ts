import type { StockQuote, StockSearchResult } from '@markettrader/shared';

export interface StockProvider {
  getQuote(symbol: string): Promise<StockQuote>;
  searchSymbols(query: string): Promise<StockSearchResult[]>;
}

export class StockProviderError extends Error {
  constructor(
    public readonly code: 'SYMBOL_NOT_FOUND' | 'PROVIDER_ERROR' | 'RATE_LIMITED',
    message: string,
  ) {
    super(message);
    this.name = 'StockProviderError';
  }
}

export class TradeError extends Error {
  constructor(
    public readonly code: 'INSUFFICIENT_FUNDS' | 'INSUFFICIENT_SHARES' | 'INVALID_QUANTITY',
    message: string,
  ) {
    super(message);
    this.name = 'TradeError';
  }
}
