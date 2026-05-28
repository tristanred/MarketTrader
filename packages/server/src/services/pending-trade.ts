import { eq, and } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import type { PendingTrade, TradeDirection, Trade } from '@markettrader/shared';
import type { StockProvider } from '../providers/index.js';
import { validateBuy, validateSell, computeNewAvgCostBasis } from './trade.js';
import { applyTradeStats } from './game-player-stats.js';

/** Parameters for queueing a trade that will settle at next market open. */
export interface ReservePendingParams {
  gamePlayerId: string;
  symbol: string;
  direction: TradeDirection;
  quantity: number;
  /** Reference price used to lock cash for buys. Should be the last-known price. */
  reservedPrice: number;
}

function rowToPending(row: typeof schema.trades.$inferSelect): PendingTrade {
  if (row.reservedPrice == null) {
    throw new Error(`pending trade ${row.id} missing reservedPrice`);
  }
  return {
    id: row.id,
    gamePlayerId: row.gamePlayerId,
    symbol: row.symbol,
    direction: row.direction as TradeDirection,
    quantity: row.quantity,
    reservedPrice: Number(row.reservedPrice),
    reservedCash: row.reservedCash == null ? null : Number(row.reservedCash),
    placedAt: row.placedAt,
  };
}

function rowToExecuted(row: typeof schema.trades.$inferSelect): Trade {
  if (row.price == null || row.executedAt == null) {
    throw new Error(`executed trade ${row.id} missing price/executedAt`);
  }
  return {
    id: row.id,
    gamePlayerId: row.gamePlayerId,
    symbol: row.symbol,
    direction: row.direction as TradeDirection,
    quantity: row.quantity,
    price: Number(row.price),
    executedAt: row.executedAt,
  };
}

/**
 * Queues a trade for settlement at next market open. For a buy, deducts
 * `quantity × reservedPrice` from the player's cash to prevent double-spending.
 * For a sell, decrements the holding (deleting the portfolio row at zero) so
 * the shares can't be sold twice. The lock is released by either
 * {@link cancelPendingTrade} or {@link settlePendingTrades}.
 *
 * @throws {TradeError} `INSUFFICIENT_FUNDS` / `INSUFFICIENT_SHARES` /
 *   `INVALID_QUANTITY` on validation failure.
 */
export async function reservePendingTrade(
  db: Db,
  params: ReservePendingParams,
): Promise<PendingTrade> {
  const { gamePlayerId, symbol, direction, quantity, reservedPrice } = params;
  const { gamePlayers, portfolios, trades } = schema;

  const [player] = await db
    .select({ cashBalance: gamePlayers.cashBalance })
    .from(gamePlayers)
    .where(eq(gamePlayers.id, gamePlayerId))
    .limit(1);
  if (!player) throw new Error(`GamePlayer not found: ${gamePlayerId}`);

  const cashBalance = Number(player.cashBalance);

  const [holding] = await db
    .select({ id: portfolios.id, quantity: portfolios.quantity })
    .from(portfolios)
    .where(and(eq(portfolios.gamePlayerId, gamePlayerId), eq(portfolios.symbol, symbol)))
    .limit(1);

  if (direction === 'buy') {
    validateBuy(cashBalance, reservedPrice, quantity);
  } else {
    validateSell(holding?.quantity ?? 0, quantity);
  }

  const reservedCash = direction === 'buy' ? quantity * reservedPrice : null;

  return db.transaction(async (tx) => {
    if (direction === 'buy') {
      await tx
        .update(gamePlayers)
        .set({ cashBalance: cashBalance - quantity * reservedPrice })
        .where(eq(gamePlayers.id, gamePlayerId));
    } else {
      const newQty = (holding?.quantity ?? 0) - quantity;
      if (newQty === 0) {
        await tx
          .delete(portfolios)
          .where(and(eq(portfolios.gamePlayerId, gamePlayerId), eq(portfolios.symbol, symbol)));
      } else if (holding) {
        await tx
          .update(portfolios)
          .set({ quantity: newQty })
          .where(eq(portfolios.id, holding.id));
      }
    }

    const [row] = await tx
      .insert(trades)
      .values({
        gamePlayerId,
        symbol,
        direction,
        quantity,
        status: 'pending',
        reservedPrice,
        reservedCash,
      })
      .returning();
    if (!row) throw new Error('Failed to insert pending trade');
    return rowToPending(row);
  });
}

/** A pending trade was not found, or was not owned by the caller. */
export class PendingTradeNotFoundError extends Error {
  constructor() {
    super('Pending trade not found');
    this.name = 'PendingTradeNotFoundError';
  }
}

/**
 * Lists pending trades for a player in the order they were placed (oldest first).
 */
export async function listPendingTrades(
  db: Db,
  gamePlayerId: string,
): Promise<PendingTrade[]> {
  const { trades } = schema;
  const rows = await db
    .select()
    .from(trades)
    .where(and(eq(trades.gamePlayerId, gamePlayerId), eq(trades.status, 'pending')));
  return rows
    .sort((a, b) => a.placedAt.localeCompare(b.placedAt))
    .map(rowToPending);
}

/**
 * Cancels a pending trade and reverses its reservation: refunds cash for a buy
 * or restores the share count for a sell. The row is kept with
 * `status='cancelled'` and `cancelledAt` set so the lifecycle is auditable.
 *
 * @throws {PendingTradeNotFoundError} if no pending row matches the (gamePlayerId, id) pair.
 */
export async function cancelPendingTrade(
  db: Db,
  gamePlayerId: string,
  pendingId: string,
): Promise<void> {
  const { gamePlayers, portfolios, trades } = schema;

  const [row] = await db
    .select()
    .from(trades)
    .where(
      and(
        eq(trades.id, pendingId),
        eq(trades.gamePlayerId, gamePlayerId),
        eq(trades.status, 'pending'),
      ),
    )
    .limit(1);
  if (!row) throw new PendingTradeNotFoundError();

  await db.transaction(async (tx) => {
    if (row.direction === 'buy') {
      const [player] = await tx
        .select({ cashBalance: gamePlayers.cashBalance })
        .from(gamePlayers)
        .where(eq(gamePlayers.id, gamePlayerId))
        .limit(1);
      if (!player) throw new Error('GamePlayer disappeared mid-cancel');
      const refund = Number(row.reservedCash ?? 0);
      await tx
        .update(gamePlayers)
        .set({ cashBalance: Number(player.cashBalance) + refund })
        .where(eq(gamePlayers.id, gamePlayerId));
    } else {
      const [holding] = await tx
        .select()
        .from(portfolios)
        .where(
          and(eq(portfolios.gamePlayerId, gamePlayerId), eq(portfolios.symbol, row.symbol)),
        )
        .limit(1);
      if (holding) {
        await tx
          .update(portfolios)
          .set({ quantity: holding.quantity + row.quantity })
          .where(eq(portfolios.id, holding.id));
      } else {
        // No row left because the sell took the holding to zero. Recreate it
        // using the row's reservedPrice as the cost basis — the only price we
        // have on hand for the lot that was reserved.
        await tx.insert(portfolios).values({
          gamePlayerId,
          symbol: row.symbol,
          quantity: row.quantity,
          avgCostBasis: Number(row.reservedPrice ?? 0),
        });
      }
    }

    await tx
      .update(trades)
      .set({ status: 'cancelled', cancelledAt: new Date().toISOString() })
      .where(eq(trades.id, pendingId));
  });
}

/** Outcome of a single pending-trade settlement attempt. */
export type SettleOutcome =
  | { kind: 'executed'; trade: Trade }
  | { kind: 'cancelled'; pendingId: string; reason: string };

/**
 * Settles every pending trade in the system: fetches a fresh quote per row,
 * finalizes the cash/portfolio mutations, and flips status to `executed`. If
 * the live cost has risen past what the buyer's remaining cash can cover, the
 * order is cancelled and the reservation refunded.
 *
 * Quote failures for one symbol do not abort the others — they leave that row
 * in `pending` so the next tick can retry.
 */
export async function settlePendingTrades(
  db: Db,
  provider: StockProvider,
): Promise<SettleOutcome[]> {
  const { gamePlayers, portfolios, trades } = schema;

  const pendings = await db
    .select()
    .from(trades)
    .where(eq(trades.status, 'pending'));

  const outcomes: SettleOutcome[] = [];

  for (const row of pendings) {
    let quote;
    try {
      quote = await provider.getQuote(row.symbol);
    } catch {
      // Skip — leave pending; next tick will retry.
      continue;
    }
    const price = quote.price;
    const direction = row.direction as TradeDirection;
    const quantity = row.quantity;
    const reservedCash = Number(row.reservedCash ?? 0);

    try {
      const outcome = await db.transaction(async (tx): Promise<SettleOutcome> => {
        const [player] = await tx
          .select({ cashBalance: gamePlayers.cashBalance })
          .from(gamePlayers)
          .where(eq(gamePlayers.id, row.gamePlayerId))
          .limit(1);
        if (!player) throw new Error('GamePlayer disappeared mid-settle');
        const cashBalance = Number(player.cashBalance);
        // Hoisted so it's available to both the new-position openedAt stamp
        // (below, in the buy branch) and the trades-row flip at the end.
        const executedAt = new Date().toISOString();

        if (direction === 'buy') {
          const actualCost = quantity * price;
          // Cash currently held back is `cashBalance` (after reservation) +
          // `reservedCash`. We need `actualCost` of that to settle the buy.
          const cashAvailable = cashBalance + reservedCash;
          if (actualCost > cashAvailable) {
            // Cancel: refund the reservation, mark row cancelled.
            await tx
              .update(gamePlayers)
              .set({ cashBalance: cashBalance + reservedCash })
              .where(eq(gamePlayers.id, row.gamePlayerId));
            await tx
              .update(trades)
              .set({
                status: 'cancelled',
                cancelledAt: new Date().toISOString(),
              })
              .where(eq(trades.id, row.id));
            return {
              kind: 'cancelled',
              pendingId: row.id,
              reason: 'INSUFFICIENT_FUNDS_AT_SETTLE',
            };
          }
          // Refund the difference (or top up if actual > reserved).
          await tx
            .update(gamePlayers)
            .set({ cashBalance: cashBalance + reservedCash - actualCost })
            .where(eq(gamePlayers.id, row.gamePlayerId));

          // Apply the buy to the portfolio.
          const [holding] = await tx
            .select()
            .from(portfolios)
            .where(
              and(
                eq(portfolios.gamePlayerId, row.gamePlayerId),
                eq(portfolios.symbol, row.symbol),
              ),
            )
            .limit(1);
          if (holding) {
            const newQty = holding.quantity + quantity;
            const newAvg = computeNewAvgCostBasis(
              holding.quantity,
              Number(holding.avgCostBasis),
              quantity,
              price,
            );
            await tx
              .update(portfolios)
              .set({ quantity: newQty, avgCostBasis: newAvg })
              .where(eq(portfolios.id, holding.id));
          } else {
            await tx.insert(portfolios).values({
              gamePlayerId: row.gamePlayerId,
              symbol: row.symbol,
              quantity,
              avgCostBasis: price,
              openedAt: executedAt,
            });
          }
        } else {
          // Sell: shares were already reserved (decremented) at placement.
          // All that's left is to credit cash.
          await tx
            .update(gamePlayers)
            .set({ cashBalance: cashBalance + quantity * price })
            .where(eq(gamePlayers.id, row.gamePlayerId));
        }

        // Stats writer must run before the trade row flips to `executed` —
        // applyTradeStats counts only `status='executed'` rows when deciding
        // the distinct-symbols delta, and the pending row in front of us
        // would otherwise (after flip) be its own "prior" trade. Same tx so
        // a later failure rolls the stats update back with everything else.
        await applyTradeStats(tx as unknown as Db, {
          gamePlayerId: row.gamePlayerId,
          direction,
          symbol: row.symbol,
          quantity,
          price,
          executedAt,
        });

        const [updated] = await tx
          .update(trades)
          .set({
            status: 'executed',
            price,
            executedAt,
            reservedPrice: null,
            reservedCash: null,
          })
          .where(eq(trades.id, row.id))
          .returning();
        if (!updated) throw new Error('Failed to flip pending → executed');
        return { kind: 'executed', trade: rowToExecuted(updated) };
      });
      outcomes.push(outcome);
    } catch {
      // Leave the row pending for the next tick.
      continue;
    }
  }

  return outcomes;
}
