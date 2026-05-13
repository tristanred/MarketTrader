import { describe, it, expect, beforeEach } from 'vitest';
import { CachedProvider } from '../../src/providers/cached-provider.js';
import { StockProviderError } from '../../src/providers/index.js';
import { createTestDb } from '../helpers/app.js';
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
});
