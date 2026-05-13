import { describe, it, expect, beforeEach, vi } from 'vitest';
import { YahooProvider } from '../../src/providers/yahoo.js';
import { StockProviderError } from '../../src/providers/index.js';

describe('YahooProvider rate-limit handling', () => {
  let provider: YahooProvider;

  beforeEach(() => {
    provider = new YahooProvider();
  });

  /**
   * Replace the internal yahoo-finance2 client with stubs we control. The
   * private `client` field is accessed via `as any` only for the test.
   */
  function stubClient(provider: YahooProvider, stubs: { quote?: unknown; search?: unknown }) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (provider as any).client = stubs;
  }

  it('maps "Too Many Requests" errors from quote() to StockProviderError(RATE_LIMITED)', async () => {
    stubClient(provider, {
      quote: vi.fn().mockRejectedValue(new Error('Too Many Requests')),
    });
    await expect(provider.getQuote('AAPL')).rejects.toMatchObject({
      name: 'StockProviderError',
      code: 'RATE_LIMITED',
    });
  });

  it('after a 429, subsequent calls inside the backoff fail fast without invoking the client', async () => {
    const mockQuote = vi.fn().mockRejectedValue(new Error('Too Many Requests'));
    stubClient(provider, { quote: mockQuote });

    await expect(provider.getQuote('AAPL')).rejects.toBeInstanceOf(StockProviderError);
    await expect(provider.getQuote('AAPL')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(mockQuote).toHaveBeenCalledTimes(1); // second call short-circuited
  });

  it('maps 429 from search() to RATE_LIMITED (no longer swallows as empty array)', async () => {
    stubClient(provider, {
      search: vi.fn().mockRejectedValue(new Error('Too Many Requests')),
    });
    await expect(provider.searchSymbols('AAPL')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });

  it('non-429 errors propagate as PROVIDER_ERROR', async () => {
    stubClient(provider, {
      quote: vi.fn().mockRejectedValue(new Error('Some other failure')),
    });
    await expect(provider.getQuote('AAPL')).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    });
  });

  it('returns a normalized StockQuote on success', async () => {
    stubClient(provider, {
      quote: vi.fn().mockResolvedValue({
        symbol: 'AAPL',
        regularMarketPrice: 175.5,
        regularMarketChange: 1.2,
        regularMarketChangePercent: 0.69,
      }),
    });
    const quote = await provider.getQuote('AAPL');
    expect(quote.symbol).toBe('AAPL');
    expect(quote.price).toBe(175.5);
    expect(quote.change).toBe(1.2);
    expect(quote.changePercent).toBe(0.69);
  });

  it('throws SYMBOL_NOT_FOUND when the upstream response lacks a price', async () => {
    stubClient(provider, { quote: vi.fn().mockResolvedValue(null) });
    await expect(provider.getQuote('NOPE')).rejects.toMatchObject({
      code: 'SYMBOL_NOT_FOUND',
    });
  });
});
