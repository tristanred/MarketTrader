import { describe, it, expect, beforeEach } from 'vitest';
import type {
  StockDetails,
  StockHistoryBar,
  StockHistoryRange,
  StockQuote,
  StockSearchResult,
} from '@markettrader/shared';
import { CachedProvider, SEARCH_CACHE_MAX_ENTRIES } from '../../src/providers/cached-provider.js';
import type { StockProvider } from '../../src/providers/index.js';
import { createTestDb } from '../helpers/app.js';
import type { Db } from '../../src/db/index.js';

/** Inner double that records the exact query string it was handed. */
class RecordingInner implements StockProvider {
  queries: string[] = [];
  results: StockSearchResult[] = [];

  async searchSymbols(query: string): Promise<StockSearchResult[]> {
    this.queries.push(query);
    return this.results;
  }

  async getQuote(symbol: string): Promise<StockQuote> {
    return { symbol, price: 100, change: 0, changePercent: 0, fetchedAt: new Date().toISOString() };
  }

  async getHistory(_symbol: string, _range: StockHistoryRange): Promise<StockHistoryBar[]> {
    return [];
  }

  async getDetails(symbol: string): Promise<StockDetails> {
    return {
      symbol,
      price: 100,
      change: 0,
      changePercent: 0,
      previousClose: 100,
      fetchedAt: new Date().toISOString(),
    };
  }
}

describe('F24 — search cache key and upstream query use the same normalization', () => {
  let db: Db;
  let inner: RecordingInner;
  let provider: CachedProvider;

  beforeEach(async () => {
    db = await createTestDb();
    inner = new RecordingInner();
    provider = new CachedProvider(db, inner);
  });

  it.each([
    [' AAPL', 'aapl'],
    ['  AAPL\t', 'aapl'],
    ['K', 'k'],
    ['MSFT', 'msft'],
  ])('sends the normalized form of %j upstream', async (raw, normalized) => {
    await provider.searchSymbols(raw);
    expect(inner.queries).toEqual([normalized]);
  });

  it('a padded query cannot populate the cache entry for the clean one', async () => {
    inner.results = [{ symbol: 'POISON', name: 'Attacker row' }];
    await provider.searchSymbols(' AAPL');

    // Same key, so this is served from cache — which is exactly why the entry
    // must have been fetched with the same string the key was derived from.
    inner.results = [{ symbol: 'AAPL', name: 'Apple Inc.' }];
    await provider.searchSymbols('AAPL');

    expect(inner.queries).toEqual(['aapl']);
  });

  it('bounds the in-memory search cache instead of growing per distinct query', async () => {
    await provider.searchSymbols('first');
    for (let i = 0; i < SEARCH_CACHE_MAX_ENTRIES; i += 1) {
      await provider.searchSymbols(`q${i}`);
    }
    const before = inner.queries.length;

    // 'first' is the oldest entry and must have been evicted, so this re-fetches.
    await provider.searchSymbols('first');
    expect(inner.queries.length).toBe(before + 1);
  });
});
