import { eq, inArray } from 'drizzle-orm';
import type {
  MarketState,
  StockDetails,
  StockHistoryBar,
  StockHistoryRange,
  StockQuote,
  StockSearchResult,
} from '@markettrader/shared';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import type { StockProvider } from './interface.js';
import { StockProviderError } from './interface.js';
import { env } from '../env.js';

/**
 * How many leading search rows get a live change%. Covers {@link SymbolSearch}'s
 * full scrollable list; the other two dropdowns slice to 8. Rows past this show
 * "—" so a long, low-relevance tail never triggers a wide batch quote.
 */
const SEARCH_ENRICH_TOP_N = 10;

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
  private readonly historyCache = new Map<
    string,
    { bars: StockHistoryBar[]; fetchedAt: number }
  >();
  /**
   * Shadow cache for `marketState`, which the persisted `stock_price_cache`
   * table doesn't store. Updated on every successful upstream fetch so cache-
   * hit reads still surface a recent session label to clients.
   */
  private readonly marketStateBySymbol = new Map<string, MarketState>();
  /**
   * In-memory cache for {@link getDetails}. Details are display-only and
   * expensive to fetch (Yahoo `quote()` is the slow path; Alpaca needs two
   * calls). Lost on restart — acceptable trade-off vs. adding a DB table.
   */
  private readonly detailsBySymbol = new Map<string, { details: StockDetails; cachedAt: number }>();

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
      const marketState = this.marketStateBySymbol.get(symbol);
      return {
        symbol,
        price: Number(cached.price),
        change: Number(cached.change),
        changePercent: Number(cached.changePercent),
        fetchedAt: cached.fetchedAt,
        ...(marketState && { marketState }),
        ...(cached.volume != null && { volume: Number(cached.volume) }),
        ...(cached.open != null && { open: Number(cached.open) }),
        ...(cached.high != null && { high: Number(cached.high) }),
        ...(cached.low != null && { low: Number(cached.low) }),
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
        const marketState = this.marketStateBySymbol.get(symbol);
        return {
          symbol,
          price: Number(cached.price),
          change: Number(cached.change),
          changePercent: Number(cached.changePercent),
          fetchedAt: cached.fetchedAt,
          stale: true,
          ...(marketState && { marketState }),
          ...(cached.volume != null && { volume: Number(cached.volume) }),
          ...(cached.open != null && { open: Number(cached.open) }),
          ...(cached.high != null && { high: Number(cached.high) }),
          ...(cached.low != null && { low: Number(cached.low) }),
        };
      }
      throw err;
    }
    await this.cacheQuote(quote);
    return quote;
  }

  /**
   * Upserts a freshly-fetched quote into the persisted price cache and mirrors
   * its market state, so subsequent {@link getQuote} reads and the rest of the
   * app share it. Shared by {@link getQuote} and search-result enrichment.
   */
  private async cacheQuote(quote: StockQuote): Promise<void> {
    if (quote.marketState) this.marketStateBySymbol.set(quote.symbol, quote.marketState);
    await this.db
      .insert(schema.stockPriceCache)
      .values({
        symbol: quote.symbol,
        price: quote.price,
        change: quote.change,
        changePercent: quote.changePercent,
        volume: quote.volume ?? null,
        open: quote.open ?? null,
        high: quote.high ?? null,
        low: quote.low ?? null,
        fetchedAt: quote.fetchedAt,
      })
      .onConflictDoUpdate({
        target: schema.stockPriceCache.symbol,
        set: {
          price: quote.price,
          change: quote.change,
          changePercent: quote.changePercent,
          volume: quote.volume ?? null,
          open: quote.open ?? null,
          high: quote.high ?? null,
          low: quote.low ?? null,
          fetchedAt: quote.fetchedAt,
        },
      });
  }

  async getHistory(symbol: string, range: StockHistoryRange): Promise<StockHistoryBar[]> {
    const key = `${symbol}|${range}`;
    const hit = this.historyCache.get(key);
    if (hit && Date.now() - hit.fetchedAt < env.STOCK_HISTORY_CACHE_TTL_MS) {
      return hit.bars;
    }
    const bars = await this.inner.getHistory(symbol, range);
    this.historyCache.set(key, { bars, fetchedAt: Date.now() });
    return bars;
  }

  async getDetails(symbol: string): Promise<StockDetails> {
    const hit = this.detailsBySymbol.get(symbol);
    const ageMs = hit ? Date.now() - hit.cachedAt : Infinity;
    if (hit && ageMs < env.STOCK_CACHE_TTL_MS) {
      return hit.details;
    }

    let details: StockDetails;
    try {
      details = await this.inner.getDetails(symbol);
    } catch (err) {
      if (
        err instanceof StockProviderError &&
        err.code === 'RATE_LIMITED' &&
        hit &&
        ageMs <= env.STOCK_STALE_PRICE_MAX_AGE_MS
      ) {
        return { ...hit.details, stale: true };
      }
      throw err;
    }

    this.detailsBySymbol.set(symbol, { details, cachedAt: Date.now() });
    return details;
  }

  async searchSymbols(query: string): Promise<StockSearchResult[]> {
    const key = query.trim().toLowerCase();
    if (key.length === 0) return [];

    // The search cache stores BARE {symbol,name} rows. The change% must never be
    // frozen by the 5-min search TTL, so it's layered on per call from the
    // shorter-lived quote cache below — not stored here.
    let base: StockSearchResult[];
    const hit = this.searchCache.get(key);
    if (hit && Date.now() - hit.fetchedAt < env.STOCK_SEARCH_CACHE_TTL_MS) {
      base = hit.results;
    } else {
      // A search-path rate-limit must still surface as 429 — keep this OUTSIDE
      // the best-effort enrichment try/catch.
      base = await this.inner.searchSymbols(query);
      this.searchCache.set(key, { results: base, fetchedAt: Date.now() });
    }

    // Best-effort enrichment: a search must never fail because a quote hiccupped.
    // Build new objects so cached rows are never mutated.
    try {
      const top = base.slice(0, SEARCH_ENRICH_TOP_N).map((r) => r.symbol);
      const pctBySymbol = await this.changePctForSymbols(top);
      return base.map((r) => {
        const pct = pctBySymbol.get(r.symbol);
        return pct === undefined ? { ...r } : { ...r, changePercent: pct };
      });
    } catch {
      return base.map((r) => ({ ...r }));
    }
  }

  /**
   * Returns the day change% for each symbol, reusing the persisted quote cache
   * for rows younger than the quote TTL and batching only the misses through
   * the inner provider's optional {@link StockProvider.getQuotes}. Freshly-
   * fetched quotes are written back to the cache. Symbols with no quote (or when
   * the inner provider has no batch path) are simply absent from the map.
   */
  private async changePctForSymbols(symbols: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (symbols.length === 0) return out;

    const cached = await this.db
      .select()
      .from(schema.stockPriceCache)
      .where(inArray(schema.stockPriceCache.symbol, symbols));

    const now = Date.now();
    const fresh = new Map<string, number>();
    for (const row of cached) {
      if (now - new Date(row.fetchedAt).getTime() < env.STOCK_CACHE_TTL_MS) {
        fresh.set(row.symbol, Number(row.changePercent));
      }
    }

    const misses = symbols.filter((s) => !fresh.has(s));
    for (const [sym, pct] of fresh) out.set(sym, pct);

    if (misses.length > 0 && this.inner.getQuotes) {
      const quotes = await this.inner.getQuotes(misses);
      for (const [sym, quote] of quotes) {
        out.set(sym, quote.changePercent);
        await this.cacheQuote(quote);
      }
    }
    return out;
  }
}
