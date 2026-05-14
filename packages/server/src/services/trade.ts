import { eq, and, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import type { TradeDirection, Trade } from '@markettrader/shared';
import { TradeError } from '../providers/index.js';

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
export async function executeTrade(db: Db, params: ExecuteTradeParams): Promise<Trade> {
  const { gamePlayerId, symbol, direction, quantity, price, existingTradeId } = params;
  const reservedCash = Number(params.reservedCash ?? 0);
  const { gamePlayers, portfolios, trades } = schema;
  const isResting = existingTradeId != null;

  const [player] = await db
    .select({ cashBalance: gamePlayers.cashBalance })
    .from(gamePlayers)
    .where(eq(gamePlayers.id, gamePlayerId))
    .limit(1);

  if (!player) throw new Error(`GamePlayer not found: ${gamePlayerId}`);

  const cashBalance = Number(player.cashBalance);

  const [holding] = await db
    .select({ id: portfolios.id, quantity: portfolios.quantity, avgCostBasis: portfolios.avgCostBasis })
    .from(portfolios)
    .where(and(eq(portfolios.gamePlayerId, gamePlayerId), eq(portfolios.symbol, symbol)))
    .limit(1);

  // Validation differs for resting orders: cash/shares were already reserved
  // at placement, so we validate against (current cash + reservation) for
  // buys and skip the share check for sells (shares were decremented then).
  if (direction === 'buy') {
    if (isResting) {
      validateBuy(cashBalance + reservedCash, price, quantity);
    } else {
      validateBuy(cashBalance, price, quantity);
    }
  } else if (!isResting) {
    validateSell(holding?.quantity ?? 0, quantity);
  } else if (!Number.isInteger(quantity) || quantity < 1) {
    throw new TradeError('INVALID_QUANTITY', 'Quantity must be a positive integer');
  }

  let newCash: number;
  let newQty: number;
  let newAvg: number;

  if (direction === 'buy') {
    // For a resting buy, the reservation has already been removed from
    // cashBalance; refund it then deduct the actual cost.
    newCash = cashBalance + (isResting ? reservedCash : 0) - quantity * price;
    newQty = (holding?.quantity ?? 0) + quantity;
    newAvg = computeNewAvgCostBasis(
      holding?.quantity ?? 0,
      Number(holding?.avgCostBasis ?? price),
      quantity,
      price,
    );
  } else {
    newCash = cashBalance + quantity * price;
    // For a resting sell, shares were already decremented at placement.
    // The portfolio update path below is skipped via the isResting flag.
    newQty = (holding?.quantity ?? 0) - (isResting ? 0 : quantity);
    newAvg = Number(holding?.avgCostBasis ?? 0);
  }

  return db.transaction(async (tx) => {
    await tx.update(gamePlayers).set({ cashBalance: newCash }).where(eq(gamePlayers.id, gamePlayerId));

    if (direction === 'buy') {
      if (holding) {
        await tx.update(portfolios).set({ quantity: newQty, avgCostBasis: newAvg }).where(eq(portfolios.id, holding.id));
      } else {
        await tx.insert(portfolios).values({ gamePlayerId, symbol, quantity: newQty, avgCostBasis: newAvg });
      }
    } else if (!isResting) {
      if (newQty === 0) {
        await tx.delete(portfolios).where(and(eq(portfolios.gamePlayerId, gamePlayerId), eq(portfolios.symbol, symbol)));
      } else {
        await tx.update(portfolios).set({ quantity: newQty }).where(and(eq(portfolios.gamePlayerId, gamePlayerId), eq(portfolios.symbol, symbol)));
      }
    }

    const executedAt = new Date().toISOString();
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

    return {
      id: trade.id,
      gamePlayerId: trade.gamePlayerId,
      symbol: trade.symbol,
      direction: trade.direction as TradeDirection,
      quantity: trade.quantity,
      price: Number(trade.price),
      executedAt: trade.executedAt,
    };
  });
}
