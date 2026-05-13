import { describe, expect, it, vi } from 'vitest';
import { YahooMarketStatus } from '../../../src/providers/market-status/yahoo.js';
import { StockProviderError } from '../../../src/providers/index.js';
import type { StockProvider } from '../../../src/providers/index.js';
import type { StockQuote } from '@markettrader/shared';

function fakeProvider(
  overrides: Partial<StockQuote> = {},
  shouldThrow: StockProviderError | null = null,
): StockProvider {
  return {
    async getQuote(symbol: string): Promise<StockQuote> {
      if (shouldThrow) throw shouldThrow;
      return {
        symbol,
        price: 500,
        change: 0,
        changePercent: 0,
        fetchedAt: new Date().toISOString(),
        ...overrides,
      };
    },
    async searchSymbols() {
      return [];
    },
    async getHistory() {
      return [];
    },
    async getDetails(symbol: string) {
      return { symbol, fetchedAt: new Date().toISOString() };
    },
  };
}

describe('YahooMarketStatus', () => {
  it('forwards the inner quote marketState', async () => {
    const inner = fakeProvider({ marketState: 'POST' });
    const provider = new YahooMarketStatus(inner);
    const s = await provider.getStatus();
    expect(s.state).toBe('POST');
    expect(s.source).toBe('yahoo');
  });

  it('defaults to CLOSED when the quote omits marketState', async () => {
    const inner = fakeProvider({});
    const provider = new YahooMarketStatus(inner);
    expect((await provider.getStatus()).state).toBe('CLOSED');
  });

  it('propagates StockProviderError from the inner provider', async () => {
    const inner = fakeProvider({}, new StockProviderError('RATE_LIMITED', 'nope'));
    const provider = new YahooMarketStatus(inner);
    await expect(provider.getStatus()).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('uses inner getQuote with the SPY probe symbol', async () => {
    const spy = vi.fn(async (sym: string): Promise<StockQuote> => ({
      symbol: sym,
      price: 500,
      change: 0,
      changePercent: 0,
      fetchedAt: new Date().toISOString(),
      marketState: 'REGULAR',
    }));
    const inner = {
      getQuote: spy,
      async searchSymbols() { return []; },
      async getHistory() { return []; },
      async getDetails(symbol: string) {
        return { symbol, fetchedAt: new Date().toISOString() };
      },
    } as StockProvider;
    await new YahooMarketStatus(inner).getStatus();
    expect(spy).toHaveBeenCalledWith('SPY');
  });
});
