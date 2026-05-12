import { eq } from 'drizzle-orm';
import type { StockQuote, StockSearchResult } from '@markettrader/shared';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import type { StockProvider } from './interface.js';
import { StockProviderError } from './interface.js';
import { env } from '../env.js';

/**
 * A {@link StockProvider} decorator that adds two caching layers on top of an
 * inner provider:
 *
 *  1. **Quote cache** — persisted in the `stock_price_cache` table. Cache hits
 *     within `STOCK_CACHE_TTL_MS` skip the upstream fetch entirely. On a fresh
 *     fetch the cache row is upserted.
 *  2. **Search cache** — an in-memory `Map<query, results>` with TTL
 *     `STOCK_SEARCH_CACHE_TTL_MS`. Search responses are static for a query
 *     within minutes; caching them protects against autocomplete bursts.
 *
 * The decorator also implements **graceful stale fallback** for `getQuote`:
 * when the inner provider throws `RATE_LIMITED` and the cache row is no older
 * than `STOCK_STALE_PRICE_MAX_AGE_MS`, the cached quote is returned with
 * `stale: true` so callers can warn or refuse. Other error codes propagate
 * unchanged.
 */
export class CachedProvider implements StockProvider {
  private readonly searchCache = new Map<string, { results: StockSearchResult[]; fetchedAt: number }>();

  constructor(
    private readonly db: Db,
    private readonly inner: StockProvider,
  ) {}

  async getQuote(symbol: string): Promise<StockQuote> {
    const [cached] = await this.db
      .select()
      .from(schema.stockPriceCache)
      .where(eq(schema.stockPriceCache.symbol, symbol))
      .limit(1);

    const cachedAt = cached ? new Date(cached.fetchedAt).getTime() : 0;
    const ageMs = Date.now() - cachedAt;

    if (cached && ageMs < env.STOCK_CACHE_TTL_MS) {
      return {
        symbol,
        price: Number(cached.price),
        change: Number(cached.change),
        changePercent: Number(cached.changePercent),
        fetchedAt: cached.fetchedAt,
      };
    }

    let quote: StockQuote;
    try {
      quote = await this.inner.getQuote(symbol);
    } catch (err) {
      // Graceful degradation: if the upstream is rate-limited and we have a
      // not-too-old cache row, serve that with stale:true. Older rows or other
      // errors propagate.
      if (
        err instanceof StockProviderError &&
        err.code === 'RATE_LIMITED' &&
        cached &&
        ageMs <= env.STOCK_STALE_PRICE_MAX_AGE_MS
      ) {
        return {
          symbol,
          price: Number(cached.price),
          change: Number(cached.change),
          changePercent: Number(cached.changePercent),
          fetchedAt: cached.fetchedAt,
          stale: true,
        };
      }
      throw err;
    }

    await this.db
      .insert(schema.stockPriceCache)
      .values({
        symbol: quote.symbol,
        price: quote.price,
        change: quote.change,
        changePercent: quote.changePercent,
        fetchedAt: quote.fetchedAt,
      })
      .onConflictDoUpdate({
        target: schema.stockPriceCache.symbol,
        set: {
          price: quote.price,
          change: quote.change,
          changePercent: quote.changePercent,
          fetchedAt: quote.fetchedAt,
        },
      });

    return quote;
  }

  async searchSymbols(query: string): Promise<StockSearchResult[]> {
    const key = query.trim().toLowerCase();
    if (key.length === 0) return [];

    const hit = this.searchCache.get(key);
    if (hit && Date.now() - hit.fetchedAt < env.STOCK_SEARCH_CACHE_TTL_MS) {
      return hit.results;
    }

    const results = await this.inner.searchSymbols(query);
    this.searchCache.set(key, { results, fetchedAt: Date.now() });
    return results;
  }
}
