import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';

export interface LeaderboardEntry {
  rank: number;
  playerId: string;
  username: string;
  cashBalance: number;
  totalValue: number;
}

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

  return entries.map(({ _joinedAt: _, ...rest }) => rest);
}
