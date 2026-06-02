import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { CachedProvider } from '../../src/providers/cached-provider.js';
import { StockProviderError } from '../../src/providers/index.js';
import { createTestDb } from '../helpers/app.js';
import { schema } from '../../src/db/index.js';
import type { Db } from '../../src/db/index.js';
import type { StockProvider } from '../../src/providers/index.js';
import type {
  StockDetails,
  StockHistoryBar,
  StockHistoryRange,
  StockQuote,
  StockSearchResult,
} from '@markettrader/shared';

/**
 * Inner-provider double that lets a test set the next response or error and
 * counts invocations so cache hits/misses can be asserted.
 */
class FakeInner implements StockProvider {
  quoteCalls = 0;
  searchCalls = 0;
  nextQuote: StockQuote | null = null;
  nextError: StockProviderError | null = null;
  nextSearch: StockSearchResult[] = [];

  /**
   * Batch-quote double. When `getQuotesImpl` is set, the provider's optional
   * `getQuotes` is exposed; tests that delete it simulate a provider without a
   * batch path. `getQuotesSymbols` records the symbols of the most recent call
   * so cache-miss batching can be asserted.
   */
  getQuotesImpl: ((symbols: string[]) => Promise<Map<string, StockQuote>>) | null = null;
  getQuotesCalls = 0;
  getQuotesSymbols: string[] = [];
  getQuotes?(symbols: string[]): Promise<Map<string, StockQuote>>;

  constructor() {
    this.getQuotes = async (symbols: string[]) => {
      this.getQuotesCalls += 1;
      this.getQuotesSymbols = symbols;
      if (this.getQuotesImpl) return this.getQuotesImpl(symbols);
      return new Map();
    };
  }

  async getQuote(symbol: string): Promise<StockQuote> {
    this.quoteCalls += 1;
    if (this.nextError) throw this.nextError;
    return this.nextQuote ?? {
      symbol,
      price: 100,
      change: 0,
      changePercent: 0,
      fetchedAt: new Date().toISOString(),
    };
  }

  async searchSymbols(_q: string): Promise<StockSearchResult[]> {
    this.searchCalls += 1;
    if (this.nextError) throw this.nextError;
    return this.nextSearch;
  }

  async getHistory(_s: string, _r: StockHistoryRange): Promise<StockHistoryBar[]> {
    if (this.nextError) throw this.nextError;
    return [];
  }

  async getDetails(symbol: string): Promise<StockDetails> {
    if (this.nextError) throw this.nextError;
    return { symbol, fetchedAt: new Date().toISOString() };
  }
}

describe('CachedProvider', () => {
  let db: Db;
  let inner: FakeInner;
  let provider: CachedProvider;

  beforeEach(async () => {
    db = await createTestDb();
    // createTestDb shares one in-memory DB across tests in this file
    // (file::memory:?cache=shared), so clear the persisted quote cache to
    // isolate enrichment tests that reuse symbols.
    await db.delete(schema.stockPriceCache);
    inner = new FakeInner();
    provider = new CachedProvider(db, inner);
  });

  describe('getQuote stale fallback', () => {
    it('on RATE_LIMITED with a recent cache row, returns the cached quote with stale:true', async () => {
      // Prime the cache with a successful fetch.
      inner.nextQuote = {
        symbol: 'AAPL',
        price: 150,
        change: 1,
        changePercent: 0.5,
        fetchedAt: new Date().toISOString(),
      };
      await provider.getQuote('AAPL');
      expect(inner.quoteCalls).toBe(1);

      // Force the cache row to be older than STOCK_CACHE_TTL_MS but younger
      // than STOCK_STALE_PRICE_MAX_AGE_MS by waiting via a manual update.
      // The TTL is 60 s by default; backdate the row by 90 s.
      const past = new Date(Date.now() - 90_000).toISOString();
      const { schema } = await import('../../src/db/index.js');
      const { eq } = await import('drizzle-orm');
      await db.update(schema.stockPriceCache).set({ fetchedAt: past }).where(eq(schema.stockPriceCache.symbol, 'AAPL'));

      // Now make the inner provider throw RATE_LIMITED. CachedProvider should
      // fall back to the (backdated) cache row with stale:true.
      inner.nextQuote = null;
      inner.nextError = new StockProviderError('RATE_LIMITED', 'mock');

      const quote = await provider.getQuote('AAPL');
      expect(quote.price).toBe(150);
      expect(quote.stale).toBe(true);
      expect(inner.quoteCalls).toBe(2); // one prime + one fallback attempt
    });

    it('on RATE_LIMITED without any cache row, the error propagates', async () => {
      inner.nextError = new StockProviderError('RATE_LIMITED', 'mock');
      await expect(provider.getQuote('NEWSYM')).rejects.toBeInstanceOf(StockProviderError);
    });

    it('on PROVIDER_ERROR even with a cache row, the error propagates (no stale fallback)', async () => {
      inner.nextQuote = {
        symbol: 'AAPL',
        price: 150,
        change: 0,
        changePercent: 0,
        fetchedAt: new Date().toISOString(),
      };
      await provider.getQuote('AAPL');
      // Backdate so we go past TTL and try inner again.
      const past = new Date(Date.now() - 90_000).toISOString();
      const { schema } = await import('../../src/db/index.js');
      const { eq } = await import('drizzle-orm');
      await db.update(schema.stockPriceCache).set({ fetchedAt: past }).where(eq(schema.stockPriceCache.symbol, 'AAPL'));

      inner.nextQuote = null;
      inner.nextError = new StockProviderError('PROVIDER_ERROR', 'mock');
      await expect(provider.getQuote('AAPL')).rejects.toBeInstanceOf(StockProviderError);
    });
  });

  describe('searchSymbols cache', () => {
    it('serves the second call from the in-memory cache', async () => {
      inner.nextSearch = [{ symbol: 'AAPL', name: 'Apple' }];
      await provider.searchSymbols('aapl');
      await provider.searchSymbols('AAPL'); // case-insensitive key
      expect(inner.searchCalls).toBe(1);
    });

    it('propagates upstream errors (does not cache failures)', async () => {
      inner.nextError = new StockProviderError('RATE_LIMITED', 'mock');
      await expect(provider.searchSymbols('AAPL')).rejects.toBeInstanceOf(StockProviderError);
      // Same query again — should still try the upstream (no negative caching here).
      await expect(provider.searchSymbols('AAPL')).rejects.toBeInstanceOf(StockProviderError);
      expect(inner.searchCalls).toBe(2);
    });
  });

  describe('searchSymbols change% enrichment', () => {
    const quoteFor = (symbol: string, changePercent: number): StockQuote => ({
      symbol,
      price: 100,
      change: 1,
      changePercent,
      fetchedAt: new Date().toISOString(),
    });

    it('enriches results with changePercent from the batch quote', async () => {
      inner.nextSearch = [
        { symbol: 'AAPL', name: 'Apple' },
        { symbol: 'MSFT', name: 'Microsoft' },
      ];
      inner.getQuotesImpl = async () =>
        new Map([
          ['AAPL', quoteFor('AAPL', 1.23)],
          ['MSFT', quoteFor('MSFT', -0.5)],
        ]);

      const results = await provider.searchSymbols('a');
      expect(results.find((r) => r.symbol === 'AAPL')?.changePercent).toBe(1.23);
      expect(results.find((r) => r.symbol === 'MSFT')?.changePercent).toBe(-0.5);
    });

    it('does not freeze the % into the search cache (symbol/name cached, % refreshed via quote path)', async () => {
      inner.nextSearch = [{ symbol: 'AAPL', name: 'Apple' }];
      inner.getQuotesImpl = async () => new Map([['AAPL', quoteFor('AAPL', 1)]]);
      const first = await provider.searchSymbols('aapl');
      expect(first[0]?.changePercent).toBe(1);

      // Backdate the quote-cache row past STOCK_CACHE_TTL_MS so the next call
      // can't reuse it and must re-batch — proving the % is NOT pinned by the
      // 5-min search cache (the symbol/name list still is).
      const past = new Date(Date.now() - 90_000).toISOString();
      await db
        .update(schema.stockPriceCache)
        .set({ fetchedAt: past })
        .where(eq(schema.stockPriceCache.symbol, 'AAPL'));

      inner.getQuotesImpl = async () => new Map([['AAPL', quoteFor('AAPL', 2)]]);
      const second = await provider.searchSymbols('aapl');
      expect(inner.searchCalls).toBe(1); // symbol/name served from the search cache
      expect(second[0]?.changePercent).toBe(2); // % refreshed, not frozen
    });

    it('reuses the persisted quote cache: only cache-miss symbols are batched', async () => {
      // Prime AAPL into the quote cache via a normal getQuote.
      inner.nextQuote = quoteFor('AAPL', 0.7);
      await provider.getQuote('AAPL');
      inner.nextQuote = null;

      inner.nextSearch = [
        { symbol: 'AAPL', name: 'Apple' },
        { symbol: 'MSFT', name: 'Microsoft' },
      ];
      inner.getQuotesImpl = async () => new Map([['MSFT', quoteFor('MSFT', 0.2)]]);

      const results = await provider.searchSymbols('a');
      // AAPL came from the persisted cache; only MSFT was batched.
      expect(inner.getQuotesSymbols).toEqual(['MSFT']);
      expect(results.find((r) => r.symbol === 'AAPL')?.changePercent).toBe(0.7);
      expect(results.find((r) => r.symbol === 'MSFT')?.changePercent).toBe(0.2);
    });

    it('degrades to symbol+name when enrichment fails (search never throws)', async () => {
      inner.nextSearch = [{ symbol: 'AAPL', name: 'Apple' }];
      inner.getQuotesImpl = async () => {
        throw new StockProviderError('RATE_LIMITED', 'mock');
      };
      const results = await provider.searchSymbols('a');
      expect(results).toEqual([{ symbol: 'AAPL', name: 'Apple' }]);
      expect(results[0]?.changePercent).toBeUndefined();
    });

    it('works when the inner provider has no getQuotes (un-enriched, no error)', async () => {
      inner.nextSearch = [{ symbol: 'AAPL', name: 'Apple' }];
      delete inner.getQuotes;
      const results = await provider.searchSymbols('a');
      expect(results).toEqual([{ symbol: 'AAPL', name: 'Apple' }]);
      expect(results[0]?.changePercent).toBeUndefined();
    });

    it('writes freshly-batched quotes back to the persisted cache', async () => {
      inner.nextSearch = [{ symbol: 'NVDA', name: 'NVIDIA' }];
      inner.getQuotesImpl = async () => new Map([['NVDA', quoteFor('NVDA', 3.3)]]);
      await provider.searchSymbols('nv');

      // A subsequent getQuote for NVDA should be served from the cache the
      // enrichment populated — no new inner.getQuote call.
      const before = inner.quoteCalls;
      const q = await provider.getQuote('NVDA');
      expect(q.changePercent).toBe(3.3);
      expect(inner.quoteCalls).toBe(before); // served from cache, not re-fetched
    });
  });
});
