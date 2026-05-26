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
 * trade row is inserted (or flipped to `executed`) — the
 * `distinctSymbolsTradedEver` delta is computed by checking for any prior
 * `trades` row with `status='executed'` on the same `(gamePlayerId, symbol)`.
 * Pending/working/cancelled rows are intentionally excluded so a placed-but-
 * never-filled order doesn't count as having "traded" the symbol, and so the
 * pending-trade settle path (which mutates an existing pending row in place)
 * still sees the delta correctly. Idempotency is the caller's concern — never
 * call twice for the same trade. Assumes single-writer-per-player ordering
 * (the trade route already serializes per-player trades inside one transaction).
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
        eq(schema.trades.status, 'executed'),
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

export interface ApplyPositionCloseStatsParams {
  gamePlayerId: string;
  realizedPnl: number;
  realizedPnlPct: number;
  holdDurationMs: number;
}

/**
 * Updates P&L-driven and hold-duration columns on every closed position
 * (i.e. every sell that reduces a holding to zero, or the realized slice of
 * a partial sell). Idempotency is the caller's concern.
 */
export async function applyPositionCloseStats(
  db: Db,
  params: ApplyPositionCloseStatsParams,
): Promise<void> {
  const row = await ensureStatsRow(db, params.gamePlayerId);
  const isWin = params.realizedPnl > 0;
  const now = new Date().toISOString();

  // Coerce nullable numeric extrema defensively — PG returns decimals as strings.
  const bestPnl = row.bestSinglePnl == null ? null : Number(row.bestSinglePnl);
  const bestPct = row.bestSinglePnlPct == null ? null : Number(row.bestSinglePnlPct);
  const worstPnl = row.worstSinglePnl == null ? null : Number(row.worstSinglePnl);
  const worstPct = row.worstSinglePnlPct == null ? null : Number(row.worstSinglePnlPct);
  const shortest = row.shortestHoldMs == null ? null : Number(row.shortestHoldMs);
  const longest = row.longestHoldMs == null ? null : Number(row.longestHoldMs);

  const nextBestPnl = bestPnl == null || params.realizedPnl > bestPnl ? params.realizedPnl : bestPnl;
  const nextBestPct = bestPct == null || params.realizedPnlPct > bestPct ? params.realizedPnlPct : bestPct;
  const nextWorstPnl = worstPnl == null || params.realizedPnl < worstPnl ? params.realizedPnl : worstPnl;
  const nextWorstPct = worstPct == null || params.realizedPnlPct < worstPct ? params.realizedPnlPct : worstPct;
  const nextShortest = shortest == null || params.holdDurationMs < shortest ? params.holdDurationMs : shortest;
  const nextLongest = longest == null || params.holdDurationMs > longest ? params.holdDurationMs : longest;

  await db
    .update(schema.gamePlayerStats)
    .set({
      realizedPnl: sql`${schema.gamePlayerStats.realizedPnl} + ${params.realizedPnl}`,
      winningClosedPositions: sql`${schema.gamePlayerStats.winningClosedPositions} + ${isWin ? 1 : 0}`,
      losingClosedPositions: sql`${schema.gamePlayerStats.losingClosedPositions} + ${isWin ? 0 : 1}`,
      consecutiveWins: isWin
        ? sql`${schema.gamePlayerStats.consecutiveWins} + 1`
        : 0,
      bestSinglePnl: nextBestPnl,
      bestSinglePnlPct: nextBestPct,
      worstSinglePnl: nextWorstPnl,
      worstSinglePnlPct: nextWorstPct,
      shortestHoldMs: nextShortest,
      longestHoldMs: nextLongest,
      updatedAt: now,
    })
    .where(eq(schema.gamePlayerStats.gamePlayerId, params.gamePlayerId));
}

export interface ApplySnapshotStatsParams {
  gamePlayerId: string;
  totalValue: number;
  rank: number;
  totalPlayers: number;
  capturedAt: string;
}

/**
 * Updates snapshot-driven stats columns for one portfolio snapshot. Must be
 * called inside the same transaction that wrote the snapshot.
 *
 * Day-level counters advance exactly once per UTC day per player. On the
 * first snapshot of a new UTC day, advance decisions consult `lastDayRank`
 * — the rank captured at the most recent snapshot of the prior day. The
 * very first snapshot ever only seeds `lastDayCounted` and `lastDayRank`
 * without advancing (there's no prior day to count for).
 *
 * Note: the final day of a game is not counted by this writer alone —
 * advance only happens at the next-day rollover. Game-end paths that need
 * the final day to count must call {@link finalizeSnapshotStats} once when
 * the game ends.
 */
export async function applySnapshotStats(
  db: Db,
  params: ApplySnapshotStatsParams,
): Promise<void> {
  const row = await ensureStatsRow(db, params.gamePlayerId);
  const now = new Date().toISOString();
  const dayKey = utcDayKey(params.capturedAt);

  const peak = row.peakPortfolioValue == null ? null : Number(row.peakPortfolioValue);
  const trough = row.troughPortfolioValue == null ? null : Number(row.troughPortfolioValue);

  const nextPeak = peak == null || params.totalValue > peak ? params.totalValue : peak;
  const nextPeakAt = peak == null || params.totalValue > peak ? params.capturedAt : row.peakPortfolioAt;
  const nextTrough = trough == null || params.totalValue < trough ? params.totalValue : trough;
  const nextTroughAt = trough == null || params.totalValue < trough ? params.capturedAt : row.troughPortfolioAt;
  const nextBestRank = row.bestRank == null || params.rank < row.bestRank ? params.rank : row.bestRank;
  const nextWorstRank = row.worstRank == null || params.rank > row.worstRank ? params.rank : row.worstRank;

  let daysAtRankOne = row.daysAtRankOne;
  let consecAtOne = row.consecutiveDaysAtRankOne;
  let daysInTop3 = row.daysInTopThree;
  let consecMedian = row.consecutiveDaysAtOrAboveMedian;
  let consecLast = row.consecutiveDaysInLastPlace;
  let lastDayCounted = row.lastDayCounted;
  let lastDayRank = row.lastDayRank;
  let previousDayRank = row.previousDayRank;

  if (row.lastDayCounted == null) {
    lastDayCounted = dayKey;
    lastDayRank = params.rank;
  } else if (row.lastDayCounted !== dayKey) {
    const priorRank = row.lastDayRank ?? params.rank;
    const wasAtOne = priorRank === 1;
    const wasInTop3 = priorRank <= 3;
    // Median: rank ≤ ceil(totalPlayers / 2). Uses the CURRENT snapshot's
    // totalPlayers — player count rarely changes mid-game.
    const wasAboveMedian = priorRank <= Math.ceil(params.totalPlayers / 2);
    const wasLast = params.totalPlayers > 1 && priorRank === params.totalPlayers;

    daysAtRankOne += wasAtOne ? 1 : 0;
    consecAtOne = wasAtOne ? consecAtOne + 1 : 0;
    daysInTop3 += wasInTop3 ? 1 : 0;
    consecMedian = wasAboveMedian ? consecMedian + 1 : 0;
    consecLast = wasLast ? consecLast + 1 : 0;

    // Capture yesterday's final rank BEFORE overwriting lastDayRank, so
    // day-over-day delta achievements can read it from the post-commit
    // event handler.
    previousDayRank = row.lastDayRank;
    lastDayCounted = dayKey;
    lastDayRank = params.rank;
  } else {
    // Same day, multiple snapshots: keep lastDayRank fresh so the next
    // rollover-time advance uses the latest known rank for that day.
    lastDayRank = params.rank;
  }

  await db
    .update(schema.gamePlayerStats)
    .set({
      peakPortfolioValue: nextPeak,
      peakPortfolioAt: nextPeakAt,
      troughPortfolioValue: nextTrough,
      troughPortfolioAt: nextTroughAt,
      bestRank: nextBestRank,
      worstRank: nextWorstRank,
      lastRank: params.rank,
      daysAtRankOne,
      consecutiveDaysAtRankOne: consecAtOne,
      daysInTopThree: daysInTop3,
      consecutiveDaysAtOrAboveMedian: consecMedian,
      consecutiveDaysInLastPlace: consecLast,
      lastDayCounted,
      lastDayRank,
      previousDayRank,
      updatedAt: now,
    })
    .where(eq(schema.gamePlayerStats.gamePlayerId, params.gamePlayerId));
}

/**
 * Counts the player's final day at its stored `lastDayRank` against the day
 * counters. Idempotent: clears `lastDayCounted` after flushing, so a second
 * call is a no-op. Call once at game end when the final day's standings
 * matter (e.g. wire-to-wire / podium-day achievements).
 */
export async function finalizeSnapshotStats(
  db: Db,
  gamePlayerId: string,
  totalPlayers: number,
): Promise<void> {
  const row = await ensureStatsRow(db, gamePlayerId);
  if (row.lastDayCounted == null || row.lastDayRank == null) return;
  const priorRank = row.lastDayRank;
  const wasAtOne = priorRank === 1;
  const wasInTop3 = priorRank <= 3;
  const wasAboveMedian = priorRank <= Math.ceil(totalPlayers / 2);
  const wasLast = totalPlayers > 1 && priorRank === totalPlayers;

  await db
    .update(schema.gamePlayerStats)
    .set({
      daysAtRankOne: row.daysAtRankOne + (wasAtOne ? 1 : 0),
      consecutiveDaysAtRankOne: wasAtOne ? row.consecutiveDaysAtRankOne + 1 : 0,
      daysInTopThree: row.daysInTopThree + (wasInTop3 ? 1 : 0),
      consecutiveDaysAtOrAboveMedian: wasAboveMedian ? row.consecutiveDaysAtOrAboveMedian + 1 : 0,
      consecutiveDaysInLastPlace: wasLast ? row.consecutiveDaysInLastPlace + 1 : 0,
      lastDayCounted: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.gamePlayerStats.gamePlayerId, gamePlayerId));
}
