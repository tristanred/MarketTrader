export class AlpacaProvider {
  async getQuote(symbol: string) {
    const res = await fetch(`https://example.invalid/${symbol}`);
    const data = (await res.json()) as { quote?: { ap?: number } };
    const price = data.quote?.ap;
    if (price == null || price <= 0) {
      throw new Error(`No quote data for ${symbol}`);
    }
    // GOOD: guarded by `price <= 0` throwing.
    return { symbol, price, change: 0 };
  }
}

export class FiniteProvider {
  async getQuote(symbol: string) {
    const res = await fetch(`https://example.invalid/${symbol}`);
    const data = (await res.json()) as { p: number };
    if (!Number.isFinite(data.p)) throw new Error('bad price');
    // GOOD: finite-checked.
    return { symbol, price: data.p };
  }
}

export class LooseProvider {
  async getQuote(symbol: string) {
    const res = await fetch(`https://example.invalid/${symbol}`);
    const data = (await res.json()) as { p: number };
    if (data.p < 0) throw new Error('negative');
    // BAD: `< 0` still admits 0.
    return { symbol, price: data.p };
  }
}
