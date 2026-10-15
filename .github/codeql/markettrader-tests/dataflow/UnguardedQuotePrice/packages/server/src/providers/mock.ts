const PRICES: Record<string, number> = { AAPL: 150 };

export class MockProvider {
  async getQuote(symbol: string) {
    // GOOD: hardcoded prices, no upstream data.
    return { symbol, price: PRICES[symbol] ?? 100 };
  }
}
