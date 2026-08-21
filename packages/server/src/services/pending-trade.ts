import { eq, and, gte, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import type { PendingTrade, TradeDirection, Trade } from '@markettrader/shared';
import type { StockProvider } from '../providers/index.js';
import { TradeError } from '../providers/index.js';
import { validateBuy, validateSell, computeNewAvgCostBasis } from './trade.js';
import { assertTradableSymbol } from './symbol.js';
import { applyTradeStats } from './game-player-stats.js';
import { onPositionOpened } from './position-high-water.js';

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
 *   `INVALID_QUANTITY` / `INVALID_SYMBOL` on validation failure.
 */
export async function reservePendingTrade(
  db: Db,
  params: ReservePendingParams,
): Promise<PendingTrade> {
  const { gamePlayerId, symbol, direction, quantity, reservedPrice } = params;
  const { gamePlayers, portfolios, trades } = schema;

  assertTradableSymbol(symbol);

  const cost = quantity * reservedPrice;
  const reservedCash = direction === 'buy' ? cost : null;

  // Every read the reservation depends on happens inside the transaction, and
  // every write is relative and carries its own guard predicate — so a
  // concurrent order for the same player can neither be validated against a
  // stale balance nor have its reservation overwritten by this one.
  return db.transaction(async (tx) => {
    const [player] = await tx
      .select({ cashBalance: gamePlayers.cashBalance })
      .from(gamePlayers)
      .where(eq(gamePlayers.id, gamePlayerId))
      .limit(1);
    if (!player) throw new Error(`GamePlayer not found: ${gamePlayerId}`);

    if (direction === 'buy') {
      validateBuy(Number(player.cashBalance), reservedPrice, quantity);
      const deducted = await tx
        .update(gamePlayers)
        .set({ cashBalance: sql`${gamePlayers.cashBalance} - ${cost}` })
        .where(and(eq(gamePlayers.id, gamePlayerId), gte(gamePlayers.cashBalance, cost)))
        .returning({ id: gamePlayers.id });
      if (deducted.length === 0) {
        throw new TradeError('INSUFFICIENT_FUNDS', 'Insufficient cash balance for this purchase');
      }
    } else {
      const [holding] = await tx
        .select({ quantity: portfolios.quantity })
        .from(portfolios)
        .where(and(eq(portfolios.gamePlayerId, gamePlayerId), eq(portfolios.symbol, symbol)))
        .limit(1);
      validateSell(holding?.quantity ?? 0, quantity);
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
 * @throws {PendingTradeNotFoundError} if no pending row matches the (gamePlayerId, id)
 *   pair, or if the row stopped being pending before this call could claim it.
 */
export async function cancelPendingTrade(
  db: Db,
  gamePlayerId: string,
  pendingId: string,
): Promise<void> {
  const { gamePlayers, portfolios, trades } = schema;

  await db.transaction(async (tx) => {
    // Ownership and status are read inside the transaction, and the terminal
    // flip repeats the `pending` predicate — so a second cancel (or the
    // settlement worker) racing this one refunds nothing rather than twice.
    const [row] = await tx
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

    if (row.direction === 'buy') {
      const refund = Number(row.reservedCash ?? 0);
      await tx
        .update(gamePlayers)
        .set({ cashBalance: sql`${gamePlayers.cashBalance} + ${refund}` })
        .where(eq(gamePlayers.id, gamePlayerId));
    } else {
      const restored = await tx
        .update(portfolios)
        .set({ quantity: sql`${portfolios.quantity} + ${row.quantity}` })
        .where(and(eq(portfolios.gamePlayerId, gamePlayerId), eq(portfolios.symbol, row.symbol)))
        .returning({ id: portfolios.id });
      if (restored.length === 0) {
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

    const flipped = await tx
      .update(trades)
      .set({ status: 'cancelled', cancelledAt: new Date().toISOString() })
      .where(and(eq(trades.id, pendingId), eq(trades.status, 'pending')))
      .returning({ id: trades.id });
    if (flipped.length === 0) throw new PendingTradeNotFoundError();
  });
}

/** Outcome of a single pending-trade settlement attempt. */
export type SettleOutcome =
  | { kind: 'executed'; trade: Trade }
  | { kind: 'cancelled'; pendingId: string; reason: string };

/**
 * Settles every pending trade whose game is still active: fetches a fresh quote
 * per row, finalizes the cash/portfolio mutations, and flips status to
 * `executed`. If the live cost has risen past what the buyer's remaining cash
 * can cover, the order is cancelled and the reservation refunded.
 *
 * Rows in games that have ended are left untouched — filling them would let a
 * player trade past the competition deadline, which the request path already
 * refuses with `GAME_NOT_ACTIVE`.
 *
 * Quote failures for one symbol do not abort the others — they leave that row
 * in `pending` so the next tick can retry.
 */
export async function settlePendingTrades(
  db: Db,
  provider: StockProvider,
): Promise<SettleOutcome[]> {
  const { games, gamePlayers, portfolios, trades } = schema;

  const pendings = await db
    .select({ row: trades })
    .from(trades)
    .innerJoin(gamePlayers, eq(trades.gamePlayerId, gamePlayers.id))
    .innerJoin(games, eq(gamePlayers.gameId, games.id))
    .where(and(eq(trades.status, 'pending'), eq(games.status, 'active')));

  const outcomes: SettleOutcome[] = [];

  for (const { row } of pendings) {
    let quote;
    try {
      quote = await provider.getQuote(row.symbol);
    } catch {
      // Skip — leave pending; next tick will retry.
      continue;
    }
    const price = quote.price;

    try {
      const outcome = await db.transaction(async (tx): Promise<SettleOutcome> => {
        // The quote above is a network round-trip: a user cancel can land
        // between the snapshot and here. Re-read under the `pending`
        // predicate and take every value from the fresh row, so a cancelled
        // order is never settled and a released reservation is never
        // re-applied. The terminal flips repeat the predicate.
        const [claimed] = await tx
          .select()
          .from(trades)
          .where(and(eq(trades.id, row.id), eq(trades.status, 'pending')))
          .limit(1);
        if (!claimed) throw new PendingTradeNotFoundError();

        const direction = claimed.direction as TradeDirection;
        const quantity = claimed.quantity;
        const reservedCash = Number(claimed.reservedCash ?? 0);

        const [player] = await tx
          .select({ cashBalance: gamePlayers.cashBalance })
          .from(gamePlayers)
          .where(eq(gamePlayers.id, claimed.gamePlayerId))
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
            // Cancel: refund the reservation, mark row cancelled. Balance
            // before trade row, matching the order every other writer here
            // uses — opposite orders across transactions deadlock on PG.
            await tx
              .update(gamePlayers)
              .set({ cashBalance: sql`${gamePlayers.cashBalance} + ${reservedCash}` })
              .where(eq(gamePlayers.id, claimed.gamePlayerId));
            const flipped = await tx
              .update(trades)
              .set({
                status: 'cancelled',
                cancelledAt: new Date().toISOString(),
              })
              .where(and(eq(trades.id, claimed.id), eq(trades.status, 'pending')))
              .returning({ id: trades.id });
            if (flipped.length === 0) throw new PendingTradeNotFoundError();
            return {
              kind: 'cancelled',
              pendingId: claimed.id,
              reason: 'INSUFFICIENT_FUNDS_AT_SETTLE',
            };
          }
          // Refund the difference (or top up if actual > reserved). Guarded so
          // the top-up cannot drive the balance negative if a concurrent write
          // spent the headroom the check above saw.
          const extraNeeded = actualCost - reservedCash;
          const settled = await tx
            .update(gamePlayers)
            .set({ cashBalance: sql`${gamePlayers.cashBalance} - ${extraNeeded}` })
            .where(
              and(
                eq(gamePlayers.id, claimed.gamePlayerId),
                gte(gamePlayers.cashBalance, extraNeeded),
              ),
            )
            .returning({ id: gamePlayers.id });
          if (settled.length === 0) {
            throw new TradeError('INSUFFICIENT_FUNDS', 'Insufficient cash to settle pending buy');
          }

          // Apply the buy to the portfolio. Read after the cash write: that
          // update locks the gamePlayers row, which serializes this player's
          // concurrent settlements, so what we read here is post-lock state.
          const [holding] = await tx
            .select()
            .from(portfolios)
            .where(
              and(
                eq(portfolios.gamePlayerId, claimed.gamePlayerId),
                eq(portfolios.symbol, claimed.symbol),
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
              gamePlayerId: claimed.gamePlayerId,
              symbol: claimed.symbol,
              quantity,
              avgCostBasis: price,
              openedAt: executedAt,
            });
            await onPositionOpened(tx as unknown as Db, {
              gamePlayerId: claimed.gamePlayerId,
              symbol: claimed.symbol,
              openedAt: executedAt,
              currentPrice: price,
              quantity,
              avgCostBasis: price,
            });
          }
        } else {
          // Sell: shares were already reserved (decremented) at placement.
          // All that's left is to credit cash.
          await tx
            .update(gamePlayers)
            .set({ cashBalance: sql`${gamePlayers.cashBalance} + ${quantity * price}` })
            .where(eq(gamePlayers.id, claimed.gamePlayerId));
        }

        // Stats writer must run before the trade row flips to `executed` —
        // applyTradeStats counts only `status='executed'` rows when deciding
        // the distinct-symbols delta, and the pending row in front of us
        // would otherwise (after flip) be its own "prior" trade. Same tx so
        // a later failure rolls the stats update back with everything else.
        await applyTradeStats(tx as unknown as Db, {
          gamePlayerId: claimed.gamePlayerId,
          direction,
          symbol: claimed.symbol,
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
          .where(and(eq(trades.id, claimed.id), eq(trades.status, 'pending')))
          .returning();
        if (!updated) throw new PendingTradeNotFoundError();
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
