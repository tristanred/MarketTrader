import { eq, inArray } from 'drizzle-orm';
import { SpanStatusCode } from '@opentelemetry/api';
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
import { meters, tracer } from '../observability/telemetry.js';

/**
 * How many leading search rows get a live change%. Covers {@link SymbolSearch}'s
 * full scrollable list; the other two dropdowns slice to 8. Rows past this show
 * "—" so a long, low-relevance tail never triggers a wide batch quote.
 */
const SEARCH_ENRICH_TOP_N = 10;

/**
 * Most distinct queries the in-memory search cache retains. `GET /stocks/search`
 * is unauthenticated and its query string is caller-chosen, so an unbounded map
 * grows for as long as someone sends fresh terms. Oldest insertion is evicted.
 */
export const SEARCH_CACHE_MAX_ENTRIES = 500;

/**
 * Symbols per upstream batch quote. Keeps one poller tick from turning into a
 * single enormous request, and bounds how much a transient upstream failure
 * costs — a failed batch loses only its own symbols for that tick.
 */
const UPSTREAM_BATCH_SIZE = 50;

/**
 * Symbols per persisted-cache read. Only there to keep the bound-parameter
 * count of a single `IN (...)` well inside every driver's ceiling when an
 * operator raises `PRICE_POLLER_MAX_SYMBOLS`.
 */
const CACHE_READ_CHUNK = 200;

/** Splits `items` into consecutive runs of at most `size`. */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * A {@link StockProvider} decorator that adds two caching layers on top of an
 * inner provider:
 *
 *  1. **Quote cache** — persisted in the `stock_price_cache` table. Cache hits
 *     within `STOCK_CACHE_TTL_MS` skip the upstream fetch entirely. On a fresh
 *     fetch the cache row is upserted.
 *  2. **Search cache** — an in-memory `Map<query, results>` with TTL
 *     `STOCK_SEARCH_CACHE_TTL_MS` and at most {@link SEARCH_CACHE_MAX_ENTRIES}
 *     keys. Search responses are static for a query within minutes; caching
 *     them protects against autocomplete bursts.
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

  /**
   * Wraps a call to the wrapped provider in a span and records its latency and
   * outcome. Rate limiting gets its own `outcome` value rather than being
   * lumped in with `error`: it is the failure mode this app actually hits, and
   * the one whose rate should drive a dashboard.
   *
   * The undici instrumentation already spans the raw HTTP request; this layer
   * adds the thing that request cannot know — which provider operation it was
   * serving, and whether the surrounding retry/fallback logic ended up happy.
   */
  private async upstream<T>(
    operation: string,
    symbol: string | undefined,
    call: () => Promise<T>,
  ): Promise<T> {
    const provider = env.STOCK_PROVIDER;
    const startedAt = Date.now();

    return tracer.startActiveSpan(
      `provider.${operation}`,
      { attributes: { 'provider.name': provider, ...(symbol && { 'provider.symbol': symbol }) } },
      async (span) => {
        let outcome = 'ok';
        try {
          return await call();
        } catch (err) {
          outcome =
            err instanceof StockProviderError && err.code === 'RATE_LIMITED'
              ? 'rate_limited'
              : 'error';
          span.recordException(err instanceof Error ? err : new Error(String(err)));
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw err;
        } finally {
          meters.providerRequests.add(1, { provider, operation, outcome });
          meters.providerDuration.record(Date.now() - startedAt, { provider, operation });
          span.end();
        }
      },
    );
  }

  async getQuote(symbol: string): Promise<StockQuote> {
    const [cached] = await this.db
      .select()
      .from(schema.stockPriceCache)
      .where(eq(schema.stockPriceCache.symbol, symbol))
      .limit(1);

    const cachedAt = cached ? new Date(cached.fetchedAt).getTime() : 0;
    const ageMs = Date.now() - cachedAt;

    if (cached && ageMs < env.STOCK_CACHE_TTL_MS) {
      meters.quoteCacheLookups.add(1, { result: 'hit' });
      return this.quoteFromCacheRow(symbol, cached);
    }

    meters.quoteCacheLookups.add(1, { result: 'miss' });

    let quote: StockQuote;
    try {
      quote = await this.upstream('getQuote', symbol, () => this.inner.getQuote(symbol));
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
        // Serving a stale price is the app degrading, not failing. It needs its
        // own bucket — folding it into `hit` would hide a rate-limit outage.
        meters.quoteCacheLookups.add(1, { result: 'stale' });
        return this.quoteFromCacheRow(symbol, cached, true);
      }
      throw err;
    }
    await this.cacheQuote(quote);
    return quote;
  }

  /**
   * Rebuilds a {@link StockQuote} from a persisted cache row, re-attaching the
   * market state from the in-memory shadow map. Pass `stale` when the row is
   * being served because the upstream is unavailable.
   */
  private quoteFromCacheRow(
    symbol: string,
    row: typeof schema.stockPriceCache.$inferSelect,
    stale = false,
  ): StockQuote {
    const marketState = this.marketStateBySymbol.get(symbol);
    return {
      symbol,
      price: Number(row.price),
      change: Number(row.change),
      changePercent: Number(row.changePercent),
      fetchedAt: row.fetchedAt,
      ...(stale && { stale: true }),
      ...(marketState && { marketState }),
      ...(row.volume != null && { volume: Number(row.volume) }),
      ...(row.open != null && { open: Number(row.open) }),
      ...(row.high != null && { high: Number(row.high) }),
      ...(row.low != null && { low: Number(row.low) }),
    };
  }

  /**
   * Batch quote for many symbols at once: one read of the persisted cache, then
   * the misses through the inner provider's batch path in
   * {@link UPSTREAM_BATCH_SIZE} chunks. This is what keeps the price poller's
   * fan-out to a handful of upstream requests per tick instead of one per symbol.
   *
   * Best-effort by contract (see {@link StockProvider.getQuotes}): a symbol with
   * no usable quote is simply absent from the map, and an upstream failure never
   * throws — it costs that chunk, not the caller's whole batch. `RATE_LIMITED`
   * degrades to cached rows marked `stale: true`, mirroring {@link getQuote}.
   * Failures are still recorded by {@link upstream}, so they stay visible in
   * traces and metrics.
   */
  async getQuotes(symbols: string[]): Promise<Map<string, StockQuote>> {
    const out = new Map<string, StockQuote>();
    const unique = [...new Set(symbols)];
    if (unique.length === 0) return out;

    const rows = new Map<string, typeof schema.stockPriceCache.$inferSelect>();
    for (const batch of chunk(unique, CACHE_READ_CHUNK)) {
      const cached = await this.db
        .select()
        .from(schema.stockPriceCache)
        .where(inArray(schema.stockPriceCache.symbol, batch));
      for (const row of cached) rows.set(row.symbol, row);
    }

    const now = Date.now();
    const misses: string[] = [];
    for (const symbol of unique) {
      const row = rows.get(symbol);
      if (row && now - new Date(row.fetchedAt).getTime() < env.STOCK_CACHE_TTL_MS) {
        meters.quoteCacheLookups.add(1, { result: 'hit' });
        out.set(symbol, this.quoteFromCacheRow(symbol, row));
      } else {
        meters.quoteCacheLookups.add(1, { result: 'miss' });
        misses.push(symbol);
      }
    }

    const fetchBatch = this.inner.getQuotes?.bind(this.inner);
    if (misses.length === 0 || !fetchBatch) return out;

    for (const batch of chunk(misses, UPSTREAM_BATCH_SIZE)) {
      try {
        const fetched = await this.upstream('getQuotes', undefined, () => fetchBatch(batch));
        for (const [sym, quote] of fetched) {
          out.set(sym, quote);
          await this.cacheQuote(quote);
        }
      } catch (err) {
        if (!(err instanceof StockProviderError) || err.code !== 'RATE_LIMITED') continue;
        for (const symbol of batch) {
          const row = rows.get(symbol);
          if (!row || now - new Date(row.fetchedAt).getTime() > env.STOCK_STALE_PRICE_MAX_AGE_MS) {
            continue;
          }
          meters.quoteCacheLookups.add(1, { result: 'stale' });
          out.set(symbol, this.quoteFromCacheRow(symbol, row, true));
        }
      }
    }
    return out;
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
    const bars = await this.upstream('getHistory', symbol, () =>
      this.inner.getHistory(symbol, range),
    );
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
      details = await this.upstream('getDetails', symbol, () => this.inner.getDetails(symbol));
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
      // The key is what upstream gets. Any two inputs that collapse to the same
      // key must produce the same upstream query, or one caller's results end up
      // cached under another caller's term. Whitespace and case are not the only
      // pair that collapses — U+212A lowercases to 'k' — so deriving both from
      // one value is the only version of this that stays true.
      //
      // A search-path rate-limit must still surface as 429 — keep this OUTSIDE
      // the best-effort enrichment try/catch.
      base = await this.upstream('searchSymbols', undefined, () =>
        this.inner.searchSymbols(key),
      );
      if (this.searchCache.size >= SEARCH_CACHE_MAX_ENTRIES) {
        const oldest = this.searchCache.keys().next();
        if (!oldest.done) this.searchCache.delete(oldest.value);
      }
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
