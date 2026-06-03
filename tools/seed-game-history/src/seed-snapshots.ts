import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '../../../packages/server/src/db/index.js';
import { withBusyTimeout } from './db-busy.js';
import type { SeededPlayer } from './seed-players.js';

/**
 * Average gap between synthetic snapshot ticks. Chosen so a 30-day game
 * yields ~100 points per player — coarse enough to keep total row counts
 * sane (e.g. 20 players × 30 days × 4 = 2,400 rows total), dense enough
 * for the sparkline + race chart to look animated. The portfolio-snapshot
 * worker uses 5 minutes in production; for synthetic backfill we don't
 * need that resolution because the underlying price data is daily bars.
 */
const SYNTHETIC_TICK_MS = 6 * 60 * 60 * 1000; // 6 hours

export interface SeedSnapshotsOptions {
  symbols: readonly string[];
  priceAt: (symbol: string, timestampISO: string) => number | null;
  /** Latest bar timestamp (ms) below which snapshots will be skipped. */
  earliestBarMs: number;
}

export interface SeedSnapshotsResult {
  inserted: number;
  ticks: number;
}

interface PlayerState {
  player: SeededPlayer;
  cash: number;
  /** symbol → quantity */
  holdings: Map<string, number>;
}

interface TradeRow {
  gamePlayerId: string;
  symbol: string;
  direction: 'buy' | 'sell';
  quantity: number;
  price: number;
  executedAt: string; // ISO
}

/**
 * Backfills `portfolio_snapshots` rows for a synthetic game by replaying
 * every executed trade in time order and emitting one snapshot per player
 * every {@link SYNTHETIC_TICK_MS}.
 *
 * The replay is needed because production's {@link recordSnapshot} reads
 * the *current* DB state — calling it post-hoc for every historical tick
 * would produce identical "final state" rows. Here we maintain an
 * in-memory mirror of cash + holdings and compute portfolio value at each
 * tick using {@link SeedSnapshotsOptions.priceAt}.
 *
 * Ranks are computed across the whole player set at each tick.
 */
export async function seedSnapshotsForGame(
  gameId: string,
  startingBalance: number,
  gameStartISO: string,
  nowISO: string,
  players: readonly SeededPlayer[],
  opts: SeedSnapshotsOptions,
): Promise<SeedSnapshotsResult> {
  if (players.length === 0) return { inserted: 0, ticks: 0 };

  // Pull every executed trade for these players, ordered by executedAt.
  // We use this to rebuild the cash + holdings state at each snapshot tick.
  const gamePlayerIds = players.map((p) => p.gamePlayerId);
  const tradeRows = await db
    .select({
      gamePlayerId: schema.trades.gamePlayerId,
      symbol: schema.trades.symbol,
      direction: schema.trades.direction,
      quantity: schema.trades.quantity,
      price: schema.trades.price,
      executedAt: schema.trades.executedAt,
      status: schema.trades.status,
    })
    .from(schema.trades)
    .where(inArray(schema.trades.gamePlayerId, gamePlayerIds));

  const trades: TradeRow[] = tradeRows
    .filter((r) => r.status === 'executed' && r.executedAt != null && r.price != null)
    .map((r) => ({
      gamePlayerId: r.gamePlayerId,
      symbol: r.symbol,
      direction: r.direction,
      quantity: r.quantity,
      price: Number(r.price),
      executedAt: r.executedAt as string,
    }))
    .sort((a, b) => a.executedAt.localeCompare(b.executedAt));

  // Build the per-player state map.
  const state = new Map<string, PlayerState>();
  for (const p of players) {
    state.set(p.gamePlayerId, {
      player: p,
      cash: startingBalance,
      holdings: new Map(),
    });
  }

  // Walk the timeline. A tick at time T applies every trade with
  // executedAt <= T that hasn't been applied yet, then snapshots the state.
  const startMs = Math.max(new Date(gameStartISO).getTime(), opts.earliestBarMs);
  const endMs = new Date(nowISO).getTime();
  if (endMs <= startMs) return { inserted: 0, ticks: 0 };

  let tradeIdx = 0;
  const inserts: (typeof schema.portfolioSnapshots.$inferInsert)[] = [];
  let ticks = 0;

  for (let t = startMs; t <= endMs; t += SYNTHETIC_TICK_MS) {
    // Apply all trades up to and including this tick.
    while (tradeIdx < trades.length && new Date(trades[tradeIdx]!.executedAt).getTime() <= t) {
      const tr = trades[tradeIdx]!;
      const s = state.get(tr.gamePlayerId);
      if (s) {
        if (tr.direction === 'buy') {
          s.cash -= tr.quantity * tr.price;
          s.holdings.set(tr.symbol, (s.holdings.get(tr.symbol) ?? 0) + tr.quantity);
        } else {
          s.cash += tr.quantity * tr.price;
          const newQty = (s.holdings.get(tr.symbol) ?? 0) - tr.quantity;
          if (newQty <= 0) s.holdings.delete(tr.symbol);
          else s.holdings.set(tr.symbol, newQty);
        }
      }
      tradeIdx++;
    }

    // Compute each player's total portfolio value at this tick using the
    // historical price-at-time lookup for held symbols. Missing prices
    // fall back to the last trade price for that symbol (which is already
    // reflected in cash if it was a sale, or the current cost basis if a
    // buy — close enough for visual continuity).
    const tickISO = new Date(t).toISOString();
    const valued: { player: SeededPlayer; totalValue: number }[] = [];
    for (const s of state.values()) {
      let holdingsValue = 0;
      for (const [symbol, qty] of s.holdings) {
        const px = opts.priceAt(symbol, tickISO);
        if (px != null) holdingsValue += qty * px;
      }
      valued.push({ player: s.player, totalValue: s.cash + holdingsValue });
    }

    valued.sort((a, b) => b.totalValue - a.totalValue);
    valued.forEach((v, i) => {
      inserts.push({
        gameId,
        gamePlayerId: v.player.gamePlayerId,
        capturedAt: tickISO,
        totalValue: v.totalValue,
        rank: i + 1,
      });
    });
    ticks++;
  }

  // SQLite's parameter limit (default 999) — five columns per row, so chunk
  // by ~150 rows to stay well below.
  const BATCH = 150;
  for (let i = 0; i < inserts.length; i += BATCH) {
    const chunk = inserts.slice(i, i + BATCH);
    await withBusyTimeout(() => db.insert(schema.portfolioSnapshots).values(chunk));
  }

  return { inserted: inserts.length, ticks };
}

/**
 * Removes any pre-existing snapshot rows for `gameId`. Idempotency for
 * re-seeding the same game — the seed tool is meant to be runnable
 * repeatedly without accumulating duplicate snapshot rows.
 */
export async function clearSnapshotsForGame(gameId: string): Promise<number> {
  const before = await db
    .select({ id: schema.portfolioSnapshots.id })
    .from(schema.portfolioSnapshots)
    .where(eq(schema.portfolioSnapshots.gameId, gameId));
  if (before.length === 0) return 0;
  await withBusyTimeout(() =>
    db.delete(schema.portfolioSnapshots).where(eq(schema.portfolioSnapshots.gameId, gameId)),
  );
  return before.length;
}
