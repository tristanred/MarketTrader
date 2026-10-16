interface Quote { price: number }
interface StockProvider { getQuote(symbol: string): Promise<Quote> }

// Test code is out of scope.
export async function testLoop(provider: StockProvider, symbols: string[]) {
  for (const s of symbols) await provider.getQuote(s);
}
