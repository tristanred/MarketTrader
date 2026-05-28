import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';

/** Inputs for {@link onPositionOpened}. */
export interface OnPositionOpenedInput {
  gamePlayerId: string;
  symbol: string;
  openedAt: string;
  currentPrice: number;
  quantity: number;
  avgCostBasis: number;
}

/**
 * Seeds (or re-seeds) the peak/trough marks for a brand-new position.
 * Called from the trade pipeline when a buy takes qty from 0 → positive.
 * Idempotent on the (gamePlayerId, symbol) PK — a second call replaces
 * the prior row, which is the right behaviour for a re-open.
 */
export async function onPositionOpened(db: Db, input: OnPositionOpenedInput): Promise<void> {
  const pnlPct = input.avgCostBasis > 0 ? input.currentPrice / input.avgCostBasis - 1 : 0;
  const value = input.currentPrice * input.quantity;
  await db
    .insert(schema.positionHighWater)
    .values({
      gamePlayerId: input.gamePlayerId,
      symbol: input.symbol,
      openedAt: input.openedAt,
      peakValue: value,
      peakPnlPct: pnlPct,
      troughPnlPct: pnlPct,
    })
    .onConflictDoUpdate({
      target: [schema.positionHighWater.gamePlayerId, schema.positionHighWater.symbol],
      set: {
        openedAt: input.openedAt,
        peakValue: value,
        peakPnlPct: pnlPct,
        troughPnlPct: pnlPct,
      },
    });
}

/** Read helpers used by achievement handlers. */
export async function getMarks(
  db: Db,
  gamePlayerId: string,
  symbol: string,
): Promise<{ openedAt: string; peakValue: number; peakPnlPct: number; troughPnlPct: number } | undefined> {
  const [row] = await db
    .select({
      openedAt: schema.positionHighWater.openedAt,
      peakValue: schema.positionHighWater.peakValue,
      peakPnlPct: schema.positionHighWater.peakPnlPct,
      troughPnlPct: schema.positionHighWater.troughPnlPct,
    })
    .from(schema.positionHighWater)
    .where(
      and(
        eq(schema.positionHighWater.gamePlayerId, gamePlayerId),
        eq(schema.positionHighWater.symbol, symbol),
      ),
    )
    .limit(1);
  return row;
}

/** Returns all open-position marks for the given game player. */
export async function getAllMarks(
  db: Db,
  gamePlayerId: string,
): Promise<Array<{ symbol: string; openedAt: string; peakValue: number; peakPnlPct: number; troughPnlPct: number }>> {
  return db
    .select({
      symbol: schema.positionHighWater.symbol,
      openedAt: schema.positionHighWater.openedAt,
      peakValue: schema.positionHighWater.peakValue,
      peakPnlPct: schema.positionHighWater.peakPnlPct,
      troughPnlPct: schema.positionHighWater.troughPnlPct,
    })
    .from(schema.positionHighWater)
    .where(eq(schema.positionHighWater.gamePlayerId, gamePlayerId));
}

/** Removes the row when a position is fully closed. */
export async function onPositionClosed(db: Db, gamePlayerId: string, symbol: string): Promise<void> {
  await db
    .delete(schema.positionHighWater)
    .where(
      and(
        eq(schema.positionHighWater.gamePlayerId, gamePlayerId),
        eq(schema.positionHighWater.symbol, symbol),
      ),
    );
}

/** Inputs to {@link updateMarks} — one row per currently-held symbol. */
export interface MarkUpdateRow {
  symbol: string;
  currentPrice: number;
  quantity: number;
  avgCostBasis: number;
}

/**
 * Per-tick refresh of every open holding's high-water marks. Implements
 * the skip-when-unchanged optimization: a row is only written if the
 * current pnl falls outside the existing band or the current value
 * exceeds the recorded peakValue.
 *
 * Holdings without a pre-existing row (e.g. the row was lost via a
 * race or admin intervention) are reseeded.
 */
export async function updateMarks(
  db: Db,
  gamePlayerId: string,
  holdings: readonly MarkUpdateRow[],
): Promise<void> {
  if (holdings.length === 0) return;
  const existing = await getAllMarks(db, gamePlayerId);
  const existingBySymbol = new Map(existing.map((r) => [r.symbol, r]));

  for (const h of holdings) {
    const pnlPct = h.avgCostBasis > 0 ? h.currentPrice / h.avgCostBasis - 1 : 0;
    const value = h.currentPrice * h.quantity;
    const prev = existingBySymbol.get(h.symbol);

    if (!prev) {
      // No row yet — seed it. Use `now` as openedAt fallback; the trade
      // pipeline normally sets the real openedAt via onPositionOpened.
      await db
        .insert(schema.positionHighWater)
        .values({
          gamePlayerId,
          symbol: h.symbol,
          openedAt: new Date().toISOString(),
          peakValue: value,
          peakPnlPct: pnlPct,
          troughPnlPct: pnlPct,
        })
        .onConflictDoNothing({
          target: [schema.positionHighWater.gamePlayerId, schema.positionHighWater.symbol],
        });
      continue;
    }

    const nextPeakPnl = Math.max(prev.peakPnlPct, pnlPct);
    const nextTroughPnl = Math.min(prev.troughPnlPct, pnlPct);
    const nextPeakValue = Math.max(prev.peakValue, value);
    if (
      nextPeakPnl === prev.peakPnlPct &&
      nextTroughPnl === prev.troughPnlPct &&
      nextPeakValue === prev.peakValue
    ) {
      continue; // skip-when-unchanged
    }
    await db
      .update(schema.positionHighWater)
      .set({
        peakPnlPct: nextPeakPnl,
        troughPnlPct: nextTroughPnl,
        peakValue: nextPeakValue,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(schema.positionHighWater.gamePlayerId, gamePlayerId),
          eq(schema.positionHighWater.symbol, h.symbol),
        ),
      );
  }
}
