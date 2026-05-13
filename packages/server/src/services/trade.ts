import { eq, and } from 'drizzle-orm';
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
  const { gamePlayerId, symbol, direction, quantity, price } = params;
  const { gamePlayers, portfolios, trades } = schema;

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

  if (direction === 'buy') {
    validateBuy(cashBalance, price, quantity);
  } else {
    validateSell(holding?.quantity ?? 0, quantity);
  }

  let newCash: number;
  let newQty: number;
  let newAvg: number;

  if (direction === 'buy') {
    newCash = cashBalance - quantity * price;
    newQty = (holding?.quantity ?? 0) + quantity;
    newAvg = computeNewAvgCostBasis(
      holding?.quantity ?? 0,
      Number(holding?.avgCostBasis ?? price),
      quantity,
      price,
    );
  } else {
    newCash = cashBalance + quantity * price;
    newQty = (holding?.quantity ?? 0) - quantity;
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
    } else {
      if (newQty === 0) {
        await tx.delete(portfolios).where(and(eq(portfolios.gamePlayerId, gamePlayerId), eq(portfolios.symbol, symbol)));
      } else {
        await tx.update(portfolios).set({ quantity: newQty }).where(and(eq(portfolios.gamePlayerId, gamePlayerId), eq(portfolios.symbol, symbol)));
      }
    }

    const [trade] = await tx.insert(trades).values({ gamePlayerId, symbol, direction, quantity, price }).returning();

    if (!trade) throw new Error('Failed to insert trade');

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
