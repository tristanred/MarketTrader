import { eq } from 'drizzle-orm';
import type { StockQuote, StockSearchResult } from '@markettrader/shared';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import type { StockProvider } from './interface.js';

/** Quotes older than this are re-fetched from the upstream provider. */
const CACHE_TTL_MS = 30_000;

/**
 * A {@link StockProvider} decorator that caches quotes in the `stock_price_cache`
 * database table for {@link CACHE_TTL_MS} milliseconds.
 *
 * Cache hits are served directly from the DB; misses delegate to the wrapped
 * `inner` provider and then upsert the result. This prevents redundant calls to
 * the upstream API when multiple routes (portfolio, trade, leaderboard) need
 * the same price within a short window.
 *
 * `searchSymbols` is never cached — it always delegates to `inner`.
 */
export class CachedProvider implements StockProvider {
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

    if (cached && Date.now() - new Date(cached.fetchedAt).getTime() < CACHE_TTL_MS) {
      return {
        symbol,
        price: Number(cached.price),
        change: Number(cached.change),
        changePercent: Number(cached.changePercent),
        fetchedAt: cached.fetchedAt,
      };
    }

    const quote = await this.inner.getQuote(symbol);

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
    return this.inner.searchSymbols(query);
  }
}
