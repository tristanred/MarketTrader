export interface StockQuote {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  fetchedAt: string;
}

export interface StockSearchResult {
  symbol: string;
  name: string;
}
