import { eq, and } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import type { TradeDirection, Trade } from '@markettrader/shared';
import { TradeError } from '../providers/index.js';

export function validateBuy(cashBalance: number, price: number, quantity: number): void {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new TradeError('INVALID_QUANTITY', 'Quantity must be a positive integer');
  }
  if (quantity * price > cashBalance) {
    throw new TradeError('INSUFFICIENT_FUNDS', 'Insufficient cash balance for this purchase');
  }
}

export function validateSell(currentQuantity: number, quantity: number): void {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new TradeError('INVALID_QUANTITY', 'Quantity must be a positive integer');
  }
  if (quantity > currentQuantity) {
    throw new TradeError('INSUFFICIENT_SHARES', 'Insufficient shares for this sale');
  }
}

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

export function computeUnrealizedPnL(
  quantity: number,
  avgCostBasis: number,
  currentPrice: number,
): number {
  return (currentPrice - avgCostBasis) * quantity;
}

export interface ExecuteTradeParams {
  gamePlayerId: string;
  symbol: string;
  direction: TradeDirection;
  quantity: number;
  price: number;
}

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

  // The project types db as BetterSQLite3Database throughout (PG is cast to it in db/index.ts).
  // better-sqlite3 transactions are synchronous; Drizzle SQLite query builders expose .run()
  // and .all() that execute immediately. These helpers avoid casting each call-site to `any`.
  // TODO(pg-async-tx): If the PG driver is ever un-cast from AppDb, replace with async transaction.
  const run = (q: { run(): unknown }): void => { q.run(); };
  const returning = <T>(q: { all(): T[] }): T[] => q.all();

  const result = db.transaction((tx: Db) => {
    run(tx.update(gamePlayers).set({ cashBalance: newCash }).where(eq(gamePlayers.id, gamePlayerId)) as { run(): unknown });

    if (direction === 'buy') {
      if (holding) {
        run(tx.update(portfolios).set({ quantity: newQty, avgCostBasis: newAvg }).where(eq(portfolios.id, holding.id)) as { run(): unknown });
      } else {
        run(tx.insert(portfolios).values({ gamePlayerId, symbol, quantity: newQty, avgCostBasis: newAvg }) as { run(): unknown });
      }
    } else {
      if (newQty === 0) {
        run(tx.delete(portfolios).where(and(eq(portfolios.gamePlayerId, gamePlayerId), eq(portfolios.symbol, symbol))) as { run(): unknown });
      } else {
        run(tx.update(portfolios).set({ quantity: newQty }).where(and(eq(portfolios.gamePlayerId, gamePlayerId), eq(portfolios.symbol, symbol))) as { run(): unknown });
      }
    }

    type TradeRow = typeof schema.trades.$inferSelect;
    const rows = returning<TradeRow>(
      tx.insert(trades).values({ gamePlayerId, symbol, direction, quantity, price }).returning() as { all(): TradeRow[] },
    );
    const trade = rows[0];

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

  return Promise.resolve(result);
}
