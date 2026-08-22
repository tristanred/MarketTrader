import { eq, inArray, and, or } from 'drizzle-orm';
import type { StockQuote } from '@markettrader/shared';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import type { StockProvider } from '../providers/index.js';
import type { GameClientRegistry } from './registry.js';
import { startIntervalWorker, type IntervalWorker } from '../workers/interval-worker.js';
import { env } from '../env.js';

const POLL_INTERVAL_MS = 5_000;

/**
 * How many `getQuote` calls may be in flight at once when the provider has no
 * batch path (Alpaca, and the mock used in tests). Kept small: the alternative
 * is one concurrent socket per symbol, which is the fan-out being bounded.
 */
const MAX_CONCURRENT_QUOTES = 8;

/** The subset of a Fastify logger the poller uses. Optional everywhere. */
export interface PricePollerLogger {
  warn(details: Record<string, number>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

/**
 * Per-poller truncation bookkeeping. The overflow condition persists across
 * ticks, so logging it unconditionally would emit a line every 5 seconds for as
 * long as it lasts; {@link pollPrices} logs the transitions instead and needs
 * somewhere to remember the last one.
 *
 * Owned by the poller rather than the module so two pollers — or two tests —
 * cannot silence each other's warnings.
 */
export interface PricePollerState {
  truncating: boolean;
}

/** Fresh {@link PricePollerState}. One per {@link startPricePoller} call. */
export function createPricePollerState(): PricePollerState {
  return { truncating: false };
}

const sharedState = createPricePollerState();

/**
 * Fetches quotes for `symbols` through the provider's batch path.
 *
 * The single-fetch loop below is for direct callers passing a bare provider;
 * in the running app the provider is always a `CachedProvider`, which defines
 * `getQuotes` unconditionally and owns the fallback for inner providers that
 * have no batch endpoint. Individual failures yield no quote rather than
 * failing the tick — same contract as {@link StockProvider.getQuotes}.
 */
async function fetchQuotes(
  provider: StockProvider,
  symbols: string[],
  logger?: PricePollerLogger,
): Promise<StockQuote[]> {
  if (provider.getQuotes) {
    try {
      return [...(await provider.getQuotes(symbols)).values()];
    } catch (err) {
      // getQuotes is contractually best-effort, so reaching here means a fault
      // below the provider — a database error, usually. Silence would leave the
      // price stream dead with nothing in the log to explain it.
      logger?.error(
        { err, symbols: symbols.length },
        'price poller batch fetch failed; no prices broadcast this tick',
      );
      return [];
    }
  }

  const out: StockQuote[] = [];
  for (let i = 0; i < symbols.length; i += MAX_CONCURRENT_QUOTES) {
    const slice = symbols.slice(i, i + MAX_CONCURRENT_QUOTES);
    const settled = await Promise.all(
      slice.map((symbol) => provider.getQuote(symbol).catch(() => null)),
    );
    for (const quote of settled) if (quote) out.push(quote);
  }
  return out;
}

/**
 * Fetches current prices for all symbols held by players in active games that
 * have at least one connected client, plus any symbols on the watchlists of
 * users currently connected to those games. Then broadcasts filtered
 * price_update events (per-client subscription filtering happens in registry).
 * Exported for unit-testing in isolation.
 *
 * At most `PRICE_POLLER_MAX_SYMBOLS` symbols are fetched per tick; `logger`
 * receives a line whenever that ceiling starts or stops truncating the set.
 */
export async function pollPrices(
  db: Db,
  provider: StockProvider,
  registry: GameClientRegistry,
  logger?: PricePollerLogger,
  state: PricePollerState = sharedState,
): Promise<void> {
  // A tick that returns before fetching has not observed an overflow. Leaving
  // the flag set would swallow the warning when the next busy period overflows
  // again — and "nobody is connected" is every night, not an edge case.
  const endTickWithoutFetch = (): void => {
    state.truncating = false;
  };
  const { games, gamePlayers, portfolios, watchlists, watchlistItems } = schema;

  const activeGameIds = registry.getActiveGameIds();
  if (activeGameIds.length === 0) return endTickWithoutFetch();

  const activeGames = await db
    .select({ id: games.id })
    .from(games)
    .where(and(inArray(games.id, activeGameIds), eq(games.status, 'active')));

  if (activeGames.length === 0) return endTickWithoutFetch();

  const liveGameIds = activeGames.map((g) => g.id);

  const holdings = await db
    .select({ gameId: gamePlayers.gameId, symbol: portfolios.symbol })
    .from(portfolios)
    .innerJoin(gamePlayers, eq(portfolios.gamePlayerId, gamePlayers.id))
    .where(inArray(gamePlayers.gameId, liveGameIds));

  // Symbols with open (working/pending) orders in any active game — needed so
  // GTC/limit/stop orders evaluate even when their owner isn't connected. The
  // CachedProvider coalesces these fetches with the worker, so this doesn't
  // multiply upstream API calls.
  const { trades } = schema;
  const openOrderSymbols = await db
    .select({ symbol: trades.symbol })
    .from(trades)
    .innerJoin(gamePlayers, eq(trades.gamePlayerId, gamePlayers.id))
    .innerJoin(games, eq(gamePlayers.gameId, games.id))
    .where(
      and(
        eq(games.status, 'active'),
        or(eq(trades.status, 'working'), eq(trades.status, 'pending')),
      ),
    );

  // Collect userIds for all clients currently connected to a live game.
  // ClientEntry.playerId is the JWT user id (see live-route.ts).
  const connectedUserIds = new Set<string>();
  for (const gameId of liveGameIds) {
    for (const [, entry] of registry.getClients(gameId)) {
      connectedUserIds.add(entry.playerId);
    }
  }

  const watchSymbols =
    connectedUserIds.size > 0
      ? await db
          .select({ symbol: watchlistItems.symbol })
          .from(watchlistItems)
          .innerJoin(watchlists, eq(watchlistItems.watchlistId, watchlists.id))
          .where(inArray(watchlists.userId, [...connectedUserIds]))
      : [];

  // Order matters: Set preserves first insertion, and the tail past the cap is
  // what gets dropped. Holdings and open orders price portfolios and fills;
  // watchlist rows are display-only and are also the set a single account can
  // inflate, so they go last.
  const ranked = [
    ...new Set([
      ...holdings.map((h) => h.symbol),
      ...openOrderSymbols.map((o) => o.symbol),
      ...watchSymbols.map((w) => w.symbol),
    ]),
  ];
  if (ranked.length === 0) return endTickWithoutFetch();

  const allSymbols = ranked.slice(0, env.PRICE_POLLER_MAX_SYMBOLS);
  const overflowed = ranked.length > allSymbols.length;
  if (overflowed && !state.truncating) {
    logger?.warn(
      {
        requested: ranked.length,
        fetched: allSymbols.length,
        dropped: ranked.length - allSymbols.length,
      },
      'price poller symbol cap reached; dropping the lowest-priority symbols each tick',
    );
  } else if (!overflowed && state.truncating) {
    logger?.warn({ requested: ranked.length }, 'price poller symbol cap no longer reached');
  }
  state.truncating = overflowed;

  const validQuotes = await fetchQuotes(provider, allSymbols, logger);
  if (validQuotes.length === 0) return;

  for (const gameId of liveGameIds) {
    registry.broadcastFiltered(gameId, validQuotes);
  }
}

/**
 * Starts the 5-second polling loop. Returns an {@link IntervalWorker} whose
 * `stop()` awaits any in-flight poll (which writes the quote cache) so it can't
 * race `closeDb()` on shutdown. Per-tick errors are swallowed — a single failed
 * poll must not crash the server.
 */
export function startPricePoller(
  db: Db,
  provider: StockProvider,
  registry: GameClientRegistry,
  logger?: PricePollerLogger,
): IntervalWorker {
  const state = createPricePollerState();
  return startIntervalWorker(
    'price-poller',
    () => pollPrices(db, provider, registry, logger, state),
    POLL_INTERVAL_MS,
  );
}
