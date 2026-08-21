import { eq, and, gte, sql } from 'drizzle-orm';
import { SpanStatusCode } from '@opentelemetry/api';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import type { TradeDirection, Trade } from '@markettrader/shared';
import { TradeError } from '../providers/index.js';
import { meters, tracer } from '../observability/telemetry.js';
import { applyTradeStats, applyPositionCloseStats } from './game-player-stats.js';
import { onPositionOpened } from './position-high-water.js';

/**
 * Validates that a buy order can be filled given the player's current cash.
 * Throws {@link TradeError} if quantity is not a positive integer or if the
 * total cost exceeds `cashBalance`.
 */
export function validateBuy(cashBalance: number, price: number, quantity: number): void {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new TradeError('INVALID_QUANTITY', 'Quantity must be a positive integer');
  }
  if (quantity * price > cashBalance) {
    throw new TradeError('INSUFFICIENT_FUNDS', 'Insufficient cash balance for this purchase');
  }
}

/**
 * Validates that a sell order can be filled given the player's current holding.
 * Throws {@link TradeError} if quantity is not a positive integer or if it
 * exceeds the shares currently held.
 */
export function validateSell(currentQuantity: number, quantity: number): void {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new TradeError('INVALID_QUANTITY', 'Quantity must be a positive integer');
  }
  if (quantity > currentQuantity) {
    throw new TradeError('INSUFFICIENT_SHARES', 'Insufficient shares for this sale');
  }
}

/**
 * Returns the new weighted-average cost basis after buying additional shares.
 *
 * @param existingQty - Shares already held before this purchase.
 * @param existingAvg - Current average cost basis per share.
 * @param newQty      - Shares being purchased.
 * @param newPrice    - Price per share for this purchase.
 */
export function computeNewAvgCostBasis(
  existingQty: number,
  existingAvg: number,
  newQty: number,
  newPrice: number,
): number {
  const total = existingQty + newQty;
  if (total === 0) return newPrice;
  return (existingQty * existingAvg + newQty * newPrice) / total;
}

/**
 * Returns unrealized profit/loss for a holding at the current market price.
 * Positive means the position is profitable; negative means a loss.
 */
export function computeUnrealizedPnL(
  quantity: number,
  avgCostBasis: number,
  currentPrice: number,
): number {
  return (currentPrice - avgCostBasis) * quantity;
}

/** Parameters required to execute a trade against the database. */
export interface ExecuteTradeParams {
  gamePlayerId: string;
  symbol: string;
  direction: TradeDirection;
  quantity: number;
  /** Execution price — the last fetched market price at time of trade. */
  price: number;
  /**
   * When set, the existing `working` trade row with this id is flipped to
   * `executed` instead of inserting a new row. Used by the trigger worker so
   * limit/stop fills preserve `placedAt` and the original order metadata.
   * The update is guarded by `status='working'` so a concurrent cancel wins
   * the race silently (no rows updated → throws).
   *
   * When set, the caller is also responsible for having already accounted
   * for any cash reservation (`reservedCash`): the reservation is released
   * inside this transaction so the cash math reuses the resting-order
   * settlement pattern from `pending-trade.ts`.
   */
  existingTradeId?: string;
  /** Cash reservation to release on fill — pass the row's `reservedCash`. */
  reservedCash?: number;
  /**
   * Whether the order's shares were already decremented from the portfolio at
   * placement (true for plain working/pending sells). Defaults to the value of
   * `existingTradeId != null` to preserve the historical behavior, but bracket
   * take-profit/stop-loss child sells must pass `false`: they are resting rows
   * (`existingTradeId` is set) yet were never reserved — only the bracket entry
   * reserves. Without this, the fill would skip the share decrement and leak
   * the position (player keeps proceeds *and* shares).
   */
  sharesAlreadyReserved?: boolean;
  /**
   * Optional ISO 8601 override for the trade's `executedAt` column. Used only
   * by the `tools/seed-game-history` utility to backdate synthetic trades.
   *
   * MUST NOT be forwarded from any HTTP request body. All route handlers
   * (`routes/trading.ts`, `routes/admin/trades.ts`) and worker call sites
   * (`services/working-order.ts`) construct `ExecuteTradeParams` explicitly
   * field-by-field — never spread untrusted input into it.
   */
  executedAt?: string;
}

/** Returned by {@link executeTrade}. Carries derived data needed for downstream event emits. */
export interface ExecuteTradeResult {
  trade: Trade;
  /** Realized P&L for this trade. 0 for buys and for resting sells (cost basis unavailable at fill). */
  realizedPnl: number;
  /** Realized P&L as a fraction of cost basis. 0 for buys and resting sells. */
  realizedPnlPct: number;
  /** ms between most recent position open and this trade. 0 for buys and resting sells. */
  holdDurationMs: number;
  /** True iff this sell brought the position to 0. False for buys, partial sells, and resting sells. */
  fullyClosed: boolean;
  /** Distinct symbols (qty > 0) held by the player after the trade. */
  distinctSymbols: number;
}

/**
 * Atomically executes a trade and updates the player's cash balance and portfolio.
 *
 * For a **buy**: deducts `quantity × price` from cash, upserts the portfolio
 * row with a recalculated average cost basis, and inserts a trade record.
 *
 * For a **sell**: credits `quantity × price` to cash, reduces the holding
 * (deleting the row when quantity reaches zero), and inserts a trade record.
 *
 * All mutations run inside a single SQLite transaction so that a failure
 * at any step leaves the database unchanged.
 *
 * @throws {Error} if the `gamePlayerId` does not exist.
 * @throws {TradeError} if the order fails validation (see {@link validateBuy} /
 *   {@link validateSell}).
 */
export async function executeTrade(db: Db, params: ExecuteTradeParams): Promise<ExecuteTradeResult> {
  const startedAt = Date.now();
  // `resting` fills come from the trigger/settlement workers, `immediate` ones
  // straight off the trade endpoint. Worth separating: they have very different
  // latency profiles and only one of them has a player waiting on it.
  const mode = params.existingTradeId != null ? 'resting' : 'immediate';

  return tracer.startActiveSpan(
    'trade.execute',
    {
      attributes: {
        'trade.symbol': params.symbol,
        'trade.direction': params.direction,
        'trade.quantity': params.quantity,
        'trade.mode': mode,
      },
    },
    async (span) => {
      try {
        const result = await runTrade(db, params);
        meters.tradesExecuted.add(1, { side: params.direction, mode });
        return result;
      } catch (err) {
        span.recordException(err instanceof Error ? err : new Error(String(err)));
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw err;
      } finally {
        meters.tradeDuration.record(Date.now() - startedAt, { side: params.direction });
        span.end();
      }
    },
  );
}

/** The transaction itself. Split out so {@link executeTrade} stays a thin telemetry wrapper. */
async function runTrade(db: Db, params: ExecuteTradeParams): Promise<ExecuteTradeResult> {
  const { gamePlayerId, symbol, direction, quantity, price, existingTradeId } = params;
  const reservedCash = Number(params.reservedCash ?? 0);
  const { gamePlayers, portfolios, trades } = schema;
  const isResting = existingTradeId != null;
  // Whether this sell's shares were physically decremented at placement.
  // Defaults to isResting (true for plain working/pending sells) but bracket
  // TP/SL children pass false — they rest without their own share reservation.
  const sharesReserved = params.sharesAlreadyReserved ?? isResting;
  const executedAt = params.executedAt ?? new Date().toISOString();

  const cost = quantity * price;

  // Everything the trade is validated against is read inside the transaction,
  // and the cash and share writes are relative and carry their own guard
  // predicate. Reading first and writing an absolute value would let two
  // orders for the same player both pass their check against one balance and
  // both write the same post-trade figure — the player keeps both positions
  // and pays for one.
  const settled = await db.transaction(async (tx) => {
    const [player] = await tx
      .select({ cashBalance: gamePlayers.cashBalance })
      .from(gamePlayers)
      .where(eq(gamePlayers.id, gamePlayerId))
      .limit(1);

    if (!player) throw new Error(`GamePlayer not found: ${gamePlayerId}`);

    const cashBalance = Number(player.cashBalance);

    const readHolding = () =>
      tx
        .select({
          id: portfolios.id,
          quantity: portfolios.quantity,
          avgCostBasis: portfolios.avgCostBasis,
          openedAt: portfolios.openedAt,
        })
        .from(portfolios)
        .where(and(eq(portfolios.gamePlayerId, gamePlayerId), eq(portfolios.symbol, symbol)))
        .limit(1);

    // A buy reads its holding after the cash write instead (see below), so it
    // needs nothing here.
    const [holding] = direction === 'sell' ? await readHolding() : [];

    // Validation differs for resting orders: cash/shares were already reserved
    // at placement, so we validate against (current cash + reservation) for
    // buys and skip the share check for sells (shares were decremented then).
    if (direction === 'buy') {
      if (isResting) {
        validateBuy(cashBalance + reservedCash, price, quantity);
      } else {
        validateBuy(cashBalance, price, quantity);
      }
    } else if (!sharesReserved) {
      // Shares weren't pre-decremented (immediate sell or bracket child) — they
      // must exist now, so validate against the live holding.
      validateSell(holding?.quantity ?? 0, quantity);
    } else if (!Number.isInteger(quantity) || quantity < 1) {
      throw new TradeError('INVALID_QUANTITY', 'Quantity must be a positive integer');
    }

    // Derive close metrics for non-resting sells from the pre-update holding.
    // Resting sells already mutated the row at placement, so cost basis isn't
    // available here — return zeros and let the caller skip downstream wiring.
    const sellAvgCost = Number(holding?.avgCostBasis ?? 0);
    const realizedPnl =
      direction === 'sell' && !isResting ? (price - sellAvgCost) * quantity : 0;
    const realizedPnlPct =
      direction === 'sell' && !isResting && sellAvgCost > 0 ? price / sellAvgCost - 1 : 0;
    const openedAtForHold =
      direction === 'sell' && !isResting ? holding?.openedAt ?? null : null;
    const holdDurationMs = openedAtForHold
      ? new Date(executedAt).getTime() - new Date(openedAtForHold).getTime()
      : 0;
    let fullyClosed = false;

    if (direction === 'buy') {
      // A resting buy's reservation is already out of cashBalance, so only the
      // shortfall above it has to come from the live balance — and it may be
      // negative, which just refunds the unused part of the reservation.
      const fromBalance = cost - (isResting ? reservedCash : 0);
      const deducted = await tx
        .update(gamePlayers)
        .set({ cashBalance: sql`${gamePlayers.cashBalance} - ${fromBalance}` })
        .where(and(eq(gamePlayers.id, gamePlayerId), gte(gamePlayers.cashBalance, fromBalance)))
        .returning({ id: gamePlayers.id });
      if (deducted.length === 0) {
        throw new TradeError('INSUFFICIENT_FUNDS', 'Insufficient cash balance for this purchase');
      }
    } else {
      await tx
        .update(gamePlayers)
        .set({ cashBalance: sql`${gamePlayers.cashBalance} + ${cost}` })
        .where(eq(gamePlayers.id, gamePlayerId));
    }

    if (direction === 'buy') {
      const [current] = await readHolding();
      if (current) {
        // Add-on buy: do not touch openedAt — position is the same one.
        //
        // Both columns are written from the row's own current values rather
        // than from `current`, which is only used to decide add-on vs new
        // position. An absolute write would be a lost update on PostgreSQL
        // READ COMMITTED: the sell paths (decrementHolding, releaseReservation,
        // and the pending reserve/cancel pair) touch `portfolios` WITHOUT
        // touching `gamePlayers`, so the cash-row lock taken above does not
        // serialize them, and a concurrent resting sell committed inside this
        // transaction would be clobbered — minting the shares it removed.
        const [updated] = await tx
          .update(portfolios)
          .set({
            quantity: sql`${portfolios.quantity} + ${quantity}`,
            avgCostBasis: sql`(${portfolios.quantity} * ${portfolios.avgCostBasis} + ${quantity * price}) / (${portfolios.quantity} + ${quantity})`,
          })
          .where(eq(portfolios.id, current.id))
          .returning({ id: portfolios.id });
        if (!updated) {
          // The position was closed and its row deleted while we were here.
          throw new TradeError('INVALID_ORDER', 'Position changed during execution; retry the trade');
        }
      } else {
        // Brand-new position — stamp openedAt so hold-duration metrics work.
        // A concurrent buy that got here first loses on unique(gamePlayerId,
        // symbol) and rolls back, rather than creating a second row.
        await tx.insert(portfolios).values({ gamePlayerId, symbol, quantity, avgCostBasis: price, openedAt: executedAt });
        await onPositionOpened(tx as unknown as Db, {
          gamePlayerId,
          symbol,
          openedAt: executedAt,
          currentPrice: price,
          quantity,
          avgCostBasis: price,
        });
      }
    } else if (!sharesReserved) {
      // Shares weren't pre-decremented (immediate sell or bracket child), so
      // take them now — guarded, so an order that raced this one to the same
      // shares fails instead of driving the holding negative.
      const [remaining] = await tx
        .update(portfolios)
        .set({ quantity: sql`${portfolios.quantity} - ${quantity}` })
        .where(
          and(
            eq(portfolios.gamePlayerId, gamePlayerId),
            eq(portfolios.symbol, symbol),
            gte(portfolios.quantity, quantity),
          ),
        )
        .returning({ id: portfolios.id, quantity: portfolios.quantity });
      if (!remaining) {
        throw new TradeError('INSUFFICIENT_SHARES', 'Insufficient shares for this sale');
      }
      if (remaining.quantity === 0) {
        await tx.delete(portfolios).where(eq(portfolios.id, remaining.id));
      }
      fullyClosed = !isResting && remaining.quantity === 0;
    }

    // Stats writers must run inside the same tx as the trade write. Trade-level
    // stats fire for every executed trade (resting sells included — they're
    // still trades). Position-close stats only fire for non-resting sells
    // where we have the cost basis to compute realized P&L.
    await applyTradeStats(tx as unknown as Db, {
      gamePlayerId,
      direction,
      symbol,
      quantity,
      price,
      executedAt,
    });

    let trade: typeof trades.$inferSelect | undefined;
    if (isResting) {
      // Guard: only flip if still in working/pending — protects against a
      // concurrent user cancel having already terminated the order.
      const [updated] = await tx
        .update(trades)
        .set({
          status: 'executed',
          price,
          executedAt,
          reservedPrice: null,
          reservedCash: null,
        })
        .where(
          and(
            eq(trades.id, existingTradeId),
            sql`${trades.status} IN ('working', 'pending')`,
          ),
        )
        .returning();
      if (!updated) {
        throw new TradeError(
          'ORDER_NOT_WORKING',
          'Order is no longer in a fillable state (likely cancelled).',
        );
      }
      trade = updated;
    } else {
      const [inserted] = await tx
        .insert(trades)
        .values({
          gamePlayerId,
          symbol,
          direction,
          quantity,
          status: 'executed',
          price,
          executedAt,
        })
        .returning();
      trade = inserted;
    }

    if (!trade) throw new Error('Failed to insert trade');
    if (trade.price == null || trade.executedAt == null) {
      throw new Error('Trade insert returned null price/executedAt');
    }

    if (direction === 'sell' && !isResting) {
      await applyPositionCloseStats(tx as unknown as Db, {
        gamePlayerId,
        realizedPnl,
        realizedPnlPct,
        holdDurationMs,
        closedAt: trade.executedAt,
      });
    }

    const result: Trade = {
      id: trade.id,
      gamePlayerId: trade.gamePlayerId,
      symbol: trade.symbol,
      direction: trade.direction as TradeDirection,
      quantity: trade.quantity,
      price: Number(trade.price),
      executedAt: trade.executedAt,
    };
    return { trade: result, realizedPnl, realizedPnlPct, holdDurationMs, fullyClosed };
  });

  const symbolsAfter = await db
    .select({ id: portfolios.id })
    .from(portfolios)
    .where(eq(portfolios.gamePlayerId, gamePlayerId));
  const distinctSymbols = symbolsAfter.length;

  return { ...settled, distinctSymbols };
}
