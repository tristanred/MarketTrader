interface Quote { price: number }

export class Cached {
  async getQuote(symbol: string): Promise<Quote> {
    return { price: symbol.length };
  }

  async getQuotes(symbols: string[]): Promise<Quote[]> {
    // Provider layer owns its own fan-out policy; not flagged.
    return Promise.all(symbols.map((s) => this.getQuote(s)));
  }
}
