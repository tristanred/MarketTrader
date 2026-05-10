import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';

/** A single player's position on the leaderboard for a given game. */
export interface LeaderboardEntry {
  rank: number;
  playerId: string;
  username: string;
  cashBalance: number;
  /** Cash balance + current market value of all holdings. */
  totalValue: number;
}

/**
 * Computes the current leaderboard for a game by joining all player holdings
 * with the stock price cache and summing each player's portfolio value.
 *
 * Ranking rules:
 * 1. Descending `totalValue` (cash + portfolio market value).
 * 2. Ties broken by ascending `joinedAt` (earlier join = higher rank).
 *
 * Portfolio value uses the cached price for each symbol. If no cache entry
 * exists the holding's `avgCostBasis` is used as a fallback so the leaderboard
 * never shows stale zeros for recently-traded symbols.
 *
 * Returns an empty array when no players have joined the game.
 */
export async function computeLeaderboard(db: Db, gameId: string): Promise<LeaderboardEntry[]> {
  const { gamePlayers, users, portfolios, stockPriceCache } = schema;

  const rows = await db
    .select({
      gpId: gamePlayers.id,
      playerId: gamePlayers.userId,
      username: users.username,
      cashBalance: gamePlayers.cashBalance,
      joinedAt: gamePlayers.joinedAt,
      symbol: portfolios.symbol,
      quantity: portfolios.quantity,
      avgCostBasis: portfolios.avgCostBasis,
      cachedPrice: stockPriceCache.price,
    })
    .from(gamePlayers)
    .innerJoin(users, eq(gamePlayers.userId, users.id))
    .leftJoin(portfolios, eq(portfolios.gamePlayerId, gamePlayers.id))
    .leftJoin(stockPriceCache, eq(stockPriceCache.symbol, portfolios.symbol))
    .where(eq(gamePlayers.gameId, gameId));

  if (rows.length === 0) return [];

  // Aggregate portfolio value per player; a single player may have multiple
  // holdings, so one SQL row is returned per (player × symbol) combination.
  const playerMap = new Map<string, {
    playerId: string;
    username: string;
    cashBalance: number;
    joinedAt: string;
    portfolioValue: number;
  }>();

  for (const row of rows) {
    if (!playerMap.has(row.gpId)) {
      playerMap.set(row.gpId, {
        playerId: row.playerId,
        username: row.username,
        cashBalance: Number(row.cashBalance),
        joinedAt: row.joinedAt,
        portfolioValue: 0,
      });
    }
    if (row.symbol != null && row.quantity != null) {
      // avgCostBasis is the last known price if the cache entry has expired or hasn't been populated yet
      const price = row.cachedPrice != null ? Number(row.cachedPrice) : Number(row.avgCostBasis);
      playerMap.get(row.gpId)!.portfolioValue += row.quantity * price;
    }
  }

  const entries = [...playerMap.values()].map(p => ({
    rank: 0,
    playerId: p.playerId,
    username: p.username,
    cashBalance: p.cashBalance,
    totalValue: p.cashBalance + p.portfolioValue,
    _joinedAt: p.joinedAt,
  }));

  entries.sort((a, b) => b.totalValue - a.totalValue || a._joinedAt.localeCompare(b._joinedAt));
  entries.forEach((e, i) => { e.rank = i + 1; });

  // Strip the internal _joinedAt field before returning.
  return entries.map(({ _joinedAt: _, ...rest }) => rest);
}
