import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';

/** Returns the `YYYY-MM-DD` UTC calendar day for an ISO 8601 timestamp. */
export function utcDayKey(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10);
}

/**
 * Upserts a zero-initialised `game_player_stats` row for the given player and
 * returns its current snapshot. Idempotent.
 */
export async function ensureStatsRow(db: Db, gamePlayerId: string) {
  await db
    .insert(schema.gamePlayerStats)
    .values({ gamePlayerId })
    .onConflictDoNothing({ target: schema.gamePlayerStats.gamePlayerId });
  const [row] = await db
    .select()
    .from(schema.gamePlayerStats)
    .where(eq(schema.gamePlayerStats.gamePlayerId, gamePlayerId))
    .limit(1);
  if (!row) throw new Error(`Stats row missing after upsert for ${gamePlayerId}`);
  return row;
}

export interface ApplyTradeStatsParams {
  gamePlayerId: string;
  direction: 'buy' | 'sell';
  symbol: string;
  quantity: number;
  price: number;
}

/**
 * Updates trade-driven stats columns for one executed trade. Must be called
 * inside the same transaction that wrote the trade row, and BEFORE that new
 * trade row is inserted — the `distinctSymbolsTradedEver` delta is computed
 * by checking for any prior `trades` row on the same `(gamePlayerId, symbol)`.
 * Idempotency is the caller's concern — never call twice for the same trade.
 */
export async function applyTradeStats(db: Db, params: ApplyTradeStatsParams): Promise<void> {
  await ensureStatsRow(db, params.gamePlayerId);

  const [prior] = await db
    .select({ id: schema.trades.id })
    .from(schema.trades)
    .where(
      and(
        eq(schema.trades.gamePlayerId, params.gamePlayerId),
        eq(schema.trades.symbol, params.symbol),
      ),
    )
    .limit(1);
  const distinctDelta = prior ? 0 : 1;
  const volume = params.quantity * params.price;
  const now = new Date().toISOString();

  await db
    .update(schema.gamePlayerStats)
    .set({
      totalTrades: sql`${schema.gamePlayerStats.totalTrades} + 1`,
      buyTrades: sql`${schema.gamePlayerStats.buyTrades} + ${params.direction === 'buy' ? 1 : 0}`,
      sellTrades: sql`${schema.gamePlayerStats.sellTrades} + ${params.direction === 'sell' ? 1 : 0}`,
      totalVolumeTraded: sql`${schema.gamePlayerStats.totalVolumeTraded} + ${volume}`,
      distinctSymbolsTradedEver: sql`${schema.gamePlayerStats.distinctSymbolsTradedEver} + ${distinctDelta}`,
      updatedAt: now,
    })
    .where(eq(schema.gamePlayerStats.gamePlayerId, params.gamePlayerId));
}
