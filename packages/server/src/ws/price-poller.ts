import { eq, inArray, and } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import type { StockProvider } from '../providers/index.js';
import type { GameClientRegistry } from './registry.js';

const POLL_INTERVAL_MS = 5_000;

/**
 * Fetches current prices for all symbols held by players in active games that
 * have at least one connected client, then broadcasts filtered price_update events.
 * Exported for unit-testing in isolation.
 */
export async function pollPrices(
  db: Db,
  provider: StockProvider,
  registry: GameClientRegistry,
): Promise<void> {
  const { games, gamePlayers, portfolios } = schema;

  const activeGameIds = registry.getActiveGameIds();
  if (activeGameIds.length === 0) return;

  const activeGames = await db
    .select({ id: games.id })
    .from(games)
    .where(and(inArray(games.id, activeGameIds), eq(games.status, 'active')));

  if (activeGames.length === 0) return;

  const liveGameIds = activeGames.map((g) => g.id);

  const holdings = await db
    .select({ gameId: gamePlayers.gameId, symbol: portfolios.symbol })
    .from(portfolios)
    .innerJoin(gamePlayers, eq(portfolios.gamePlayerId, gamePlayers.id))
    .where(inArray(gamePlayers.gameId, liveGameIds));

  const allSymbols = [...new Set(holdings.map((h) => h.symbol))];
  if (allSymbols.length === 0) return;

  const quotes = await Promise.all(
    allSymbols.map((symbol) => provider.getQuote(symbol).catch(() => null)),
  );
  const validQuotes = quotes.filter((q): q is NonNullable<typeof q> => q !== null);
  if (validQuotes.length === 0) return;

  for (const gameId of liveGameIds) {
    registry.broadcastFiltered(gameId, validQuotes);
  }
}

/**
 * Starts the 5-second polling loop.
 * Returns the interval handle — pass it to `clearInterval` in an `onClose` hook.
 */
export function startPricePoller(
  db: Db,
  provider: StockProvider,
  registry: GameClientRegistry,
): ReturnType<typeof setInterval> {
  let polling = false;
  return setInterval(() => {
    if (polling) return;
    polling = true;
    pollPrices(db, provider, registry)
      .catch(() => {
        // Swallow per-tick errors — a single failed poll must not crash the server
      })
      .finally(() => {
        polling = false;
      });
  }, POLL_INTERVAL_MS);
}
