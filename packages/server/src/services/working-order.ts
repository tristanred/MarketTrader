import { eq, and, inArray, sql, isNull, or } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import type {
  BracketRole,
  OrderType,
  TimeInForce,
  Trade,
  TradeDirection,
  WorkingOrder,
} from '@markettrader/shared';
import type { StockProvider } from '../providers/index.js';
import { TradeError } from '../providers/index.js';
import { executeTrade, type ExecuteTradeResult } from './trade.js';

type TradeRow = typeof schema.trades.$inferSelect;

/**
 * Maps a `trades` row in the `working` or `pending` (resting-order) lifecycle
 * stage to the public {@link WorkingOrder} shape. Throws if the row is
 * actually executed/cancelled — callers should pre-filter.
 */
export function rowToWorkingOrder(row: TradeRow): WorkingOrder {
  return {
    id: row.id,
    gamePlayerId: row.gamePlayerId,
    symbol: row.symbol,
    direction: row.direction as TradeDirection,
    quantity: row.quantity,
    orderType: row.orderType as OrderType,
    timeInForce: row.timeInForce as TimeInForce,
    limitPrice: row.limitPrice == null ? null : Number(row.limitPrice),
    stopPrice: row.stopPrice == null ? null : Number(row.stopPrice),
    stopTriggeredAt: row.stopTriggeredAt ?? null,
    parentTradeId: row.parentTradeId ?? null,
    bracketRole: (row.bracketRole as BracketRole | null) ?? null,
    takeProfitPrice: row.takeProfitPrice == null ? null : Number(row.takeProfitPrice),
    stopLossPrice: row.stopLossPrice == null ? null : Number(row.stopLossPrice),
    expiresAt: row.expiresAt ?? null,
    reservedCash: row.reservedCash == null ? null : Number(row.reservedCash),
    placedAt: row.placedAt,
  };
}

/** Input shape for {@link placeWorkingOrder}. */
export interface PlaceWorkingOrderInput {
  gamePlayerId: string;
  symbol: string;
  direction: TradeDirection;
  quantity: number;
  orderType: OrderType;
  timeInForce: TimeInForce;
  limitPrice?: number;
  stopPrice?: number;
  /** Required when `orderType='bracket'`. */
  takeProfitPrice?: number;
  /** Required when `orderType='bracket'`. */
  stopLossPrice?: number;
  /**
   * Reference price used to estimate the cash reservation for stop orders
   * (which have no limit price ceiling). Typically the current quote.
   */
  referencePrice?: number;
  /** ISO 8601 expiry for day-TIF orders. Computed by the caller. */
  expiresAt?: string;
}

/**
 * Returns the cash currently available for new buys: `cashBalance` minus any
 * cash already reserved by pending/working buy orders for this player.
 *
 * `cashBalance` itself already excludes reservations made by pending market
 * orders (see {@link reservePendingTrade}) — this helper subtracts the
 * additional reservations held by `working` rows in the same way.
 */
export async function availableCash(db: Db, gamePlayerId: string): Promise<number> {
  const { gamePlayers } = schema;
  const [player] = await db
    .select({ cashBalance: gamePlayers.cashBalance })
    .from(gamePlayers)
    .where(eq(gamePlayers.id, gamePlayerId))
    .limit(1);
  if (!player) throw new Error(`GamePlayer not found: ${gamePlayerId}`);
  return Number(player.cashBalance);
}

/**
 * Returns the shares currently available to sell for `(gamePlayerId, symbol)`.
 *
 * Because both pending and working sells *physically* decrement the portfolio
 * row at placement time (see `placeWorkingOrder` and `reservePendingTrade`),
 * `portfolios.quantity` is already net of reservations. So available =
 * `portfolios.quantity`. Returned for callers that want a single source of
 * truth without re-reading the portfolio table directly.
 */
export async function availableShares(
  db: Db,
  gamePlayerId: string,
  symbol: string,
): Promise<number> {
  const { portfolios } = schema;
  const [holding] = await db
    .select({ quantity: portfolios.quantity })
    .from(portfolios)
    .where(and(eq(portfolios.gamePlayerId, gamePlayerId), eq(portfolios.symbol, symbol)))
    .limit(1);
  return holding?.quantity ?? 0;
}

/**
 * Validates the shape of a working-order input. Throws `TradeError('INVALID_ORDER')`
 * with a descriptive message on logical inconsistencies. Quantity validity
 * is enforced separately by the existing `validateBuy`/`validateSell` helpers
 * called from the route layer.
 */
function validateWorkingOrderShape(input: PlaceWorkingOrderInput): void {
  const { orderType, limitPrice, stopPrice, takeProfitPrice, stopLossPrice, direction } = input;

  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new TradeError('INVALID_QUANTITY', 'Quantity must be a positive integer');
  }

  switch (orderType) {
    case 'limit':
      if (limitPrice == null || limitPrice <= 0) {
        throw new TradeError('INVALID_ORDER', 'Limit orders require a positive limitPrice');
      }
      break;
    case 'stop':
      if (stopPrice == null || stopPrice <= 0) {
        throw new TradeError('INVALID_ORDER', 'Stop orders require a positive stopPrice');
      }
      break;
    case 'stop_limit':
      if (limitPrice == null || limitPrice <= 0 || stopPrice == null || stopPrice <= 0) {
        throw new TradeError(
          'INVALID_ORDER',
          'Stop-limit orders require both stopPrice and limitPrice',
        );
      }
      break;
    case 'bracket':
      if (takeProfitPrice == null || stopLossPrice == null) {
        throw new TradeError(
          'INVALID_ORDER',
          'Bracket orders require both takeProfitPrice and stopLossPrice',
        );
      }
      if (takeProfitPrice <= 0 || stopLossPrice <= 0) {
        throw new TradeError('INVALID_ORDER', 'Bracket prices must be positive');
      }
      // For a long entry (buy), TP > entry > SL. The "entry" reference is the
      // limit price if provided, otherwise the reference quote.
      if (direction === 'buy' && takeProfitPrice <= stopLossPrice) {
        throw new TradeError(
          'INVALID_ORDER',
          'For a long bracket, takeProfitPrice must be greater than stopLossPrice',
        );
      }
      if (direction === 'sell' && takeProfitPrice >= stopLossPrice) {
        throw new TradeError(
          'INVALID_ORDER',
          'For a short bracket, takeProfitPrice must be less than stopLossPrice',
        );
      }
      break;
    case 'market':
      throw new TradeError(
        'INVALID_ORDER',
        'Market orders are not placed as working orders',
      );
  }
}

/**
 * Computes the cash to reserve for a buy. Uses the most-conservative price the
 * order could fill at: `limitPrice` for limit/stop_limit (the ceiling),
 * `stopPrice` for plain stops (best estimate at trigger; if the quote gaps
 * higher, the worker will cancel with `INSUFFICIENT_FUNDS_AT_FILL`).
 */
function computeBuyReservation(input: PlaceWorkingOrderInput): number {
  const { orderType, limitPrice, stopPrice, referencePrice, quantity } = input;
  const unit =
    orderType === 'limit' || orderType === 'stop_limit'
      ? (limitPrice as number)
      : orderType === 'stop'
        ? (stopPrice as number)
        : (referencePrice ?? 0);
  return unit * quantity;
}

/**
 * Places a non-market order. For limit/stop/stop_limit this inserts a single
 * `working` row with the appropriate cash/share reservation. For bracket
 * orders this inserts three rows in one transaction: the entry plus two
 * children that stay `working` (skipped by the evaluator until the parent
 * fills, via the `parentTradeId IS NULL OR parent.status='executed'` filter).
 *
 * @throws {TradeError} — `INSUFFICIENT_FUNDS` / `INSUFFICIENT_SHARES` /
 *   `INVALID_QUANTITY` / `INVALID_ORDER`.
 */
export async function placeWorkingOrder(
  db: Db,
  input: PlaceWorkingOrderInput,
): Promise<WorkingOrder[]> {
  validateWorkingOrderShape(input);

  const { gamePlayers, portfolios, trades } = schema;
  const {
    gamePlayerId,
    symbol,
    direction,
    quantity,
    orderType,
    timeInForce,
    limitPrice,
    stopPrice,
    takeProfitPrice,
    stopLossPrice,
    expiresAt,
  } = input;

  // Preflight checks against current availability — done outside the txn so
  // the error path stays cheap. The txn re-reads cash/portfolio to avoid the
  // narrow race where two concurrent placements both pass preflight.
  if (orderType === 'bracket') {
    // Entry-direction reservation only; the children are implicit until parent fills.
    if (direction === 'buy') {
      const cash = await availableCash(db, gamePlayerId);
      const need = (limitPrice ?? input.referencePrice ?? 0) * quantity;
      if (need <= 0) {
        throw new TradeError(
          'INVALID_ORDER',
          'Cannot determine bracket reservation without a limit or reference price',
        );
      }
      if (need > cash) {
        throw new TradeError('INSUFFICIENT_FUNDS', 'Insufficient cash for bracket entry');
      }
    } else {
      const avail = await availableShares(db, gamePlayerId, symbol);
      if (quantity > avail) {
        throw new TradeError('INSUFFICIENT_SHARES', 'Insufficient shares for bracket entry');
      }
    }
  } else if (direction === 'buy') {
    const cash = await availableCash(db, gamePlayerId);
    const need = computeBuyReservation(input);
    if (need <= 0) {
      throw new TradeError('INVALID_ORDER', 'Cannot determine cash reservation');
    }
    if (need > cash) {
      throw new TradeError('INSUFFICIENT_FUNDS', 'Insufficient cash to reserve order');
    }
  } else {
    const avail = await availableShares(db, gamePlayerId, symbol);
    if (quantity > avail) {
      throw new TradeError('INSUFFICIENT_SHARES', 'Insufficient shares to reserve order');
    }
  }

  return db.transaction(async (tx) => {
    const reservedCash =
      direction === 'buy' && orderType !== 'bracket' ? computeBuyReservation(input) : null;

    // For non-bracket buys, deduct cash from the player.
    if (direction === 'buy' && orderType !== 'bracket') {
      const [player] = await tx
        .select({ cashBalance: gamePlayers.cashBalance })
        .from(gamePlayers)
        .where(eq(gamePlayers.id, gamePlayerId))
        .limit(1);
      if (!player) throw new Error(`GamePlayer disappeared: ${gamePlayerId}`);
      const cash = Number(player.cashBalance);
      if ((reservedCash ?? 0) > cash) {
        throw new TradeError('INSUFFICIENT_FUNDS', 'Insufficient cash to reserve order');
      }
      await tx
        .update(gamePlayers)
        .set({ cashBalance: cash - (reservedCash ?? 0) })
        .where(eq(gamePlayers.id, gamePlayerId));
    }

    // For non-bracket sells, decrement portfolio quantity.
    if (direction === 'sell' && orderType !== 'bracket') {
      const [holding] = await tx
        .select({ id: portfolios.id, quantity: portfolios.quantity })
        .from(portfolios)
        .where(and(eq(portfolios.gamePlayerId, gamePlayerId), eq(portfolios.symbol, symbol)))
        .limit(1);
      if (!holding || holding.quantity < quantity) {
        throw new TradeError('INSUFFICIENT_SHARES', 'Insufficient shares to reserve order');
      }
      const newQty = holding.quantity - quantity;
      if (newQty === 0) {
        await tx.delete(portfolios).where(eq(portfolios.id, holding.id));
      } else {
        await tx.update(portfolios).set({ quantity: newQty }).where(eq(portfolios.id, holding.id));
      }
    }

    if (orderType === 'bracket') {
      // Insert parent (entry) — uses `limit` semantics if limitPrice is set,
      // otherwise `market` (executes at next available quote when triggered).
      const entryOrderType: OrderType = limitPrice != null ? 'limit' : 'market';
      // Bracket parents (market entries) don't have a "trigger" — they
      // execute on the next worker tick at the current quote. We still
      // store them as `working` so the worker picks them up; the evaluator
      // treats a working market-entry as immediately fillable.
      const [parent] = await tx
        .insert(trades)
        .values({
          gamePlayerId,
          symbol,
          direction,
          quantity,
          status: 'working',
          orderType: entryOrderType,
          timeInForce,
          limitPrice: limitPrice ?? null,
          parentTradeId: null,
          bracketRole: 'entry',
          takeProfitPrice: takeProfitPrice ?? null,
          stopLossPrice: stopLossPrice ?? null,
          expiresAt: expiresAt ?? null,
          // Reservation on the parent: cash for a buy entry, none for a sell entry.
          reservedPrice: limitPrice ?? input.referencePrice ?? null,
          reservedCash:
            direction === 'buy'
              ? (limitPrice ?? input.referencePrice ?? 0) * quantity
              : null,
        })
        .returning();
      if (!parent) throw new Error('Failed to insert bracket parent');

      // Deduct cash for buy-entry / decrement portfolio for sell-entry
      // (mirrors the non-bracket branches above).
      if (direction === 'buy') {
        const [player] = await tx
          .select({ cashBalance: gamePlayers.cashBalance })
          .from(gamePlayers)
          .where(eq(gamePlayers.id, gamePlayerId))
          .limit(1);
        if (!player) throw new Error('GamePlayer disappeared');
        const need = Number(parent.reservedCash ?? 0);
        const cash = Number(player.cashBalance);
        if (need > cash) {
          throw new TradeError('INSUFFICIENT_FUNDS', 'Insufficient cash for bracket entry');
        }
        await tx
          .update(gamePlayers)
          .set({ cashBalance: cash - need })
          .where(eq(gamePlayers.id, gamePlayerId));
      } else {
        const [holding] = await tx
          .select({ id: portfolios.id, quantity: portfolios.quantity })
          .from(portfolios)
          .where(and(eq(portfolios.gamePlayerId, gamePlayerId), eq(portfolios.symbol, symbol)))
          .limit(1);
        if (!holding || holding.quantity < quantity) {
          throw new TradeError('INSUFFICIENT_SHARES', 'Insufficient shares for bracket entry');
        }
        const newQty = holding.quantity - quantity;
        if (newQty === 0) {
          await tx.delete(portfolios).where(eq(portfolios.id, holding.id));
        } else {
          await tx
            .update(portfolios)
            .set({ quantity: newQty })
            .where(eq(portfolios.id, holding.id));
        }
      }

      // Children: opposite direction. They become eligible only after parent fills.
      const childDirection: TradeDirection = direction === 'buy' ? 'sell' : 'buy';
      const [tp] = await tx
        .insert(trades)
        .values({
          gamePlayerId,
          symbol,
          direction: childDirection,
          quantity,
          status: 'working',
          orderType: 'limit',
          timeInForce,
          limitPrice: takeProfitPrice!,
          parentTradeId: parent.id,
          bracketRole: 'take_profit',
          expiresAt: expiresAt ?? null,
        })
        .returning();
      if (!tp) throw new Error('Failed to insert TP child');

      const [sl] = await tx
        .insert(trades)
        .values({
          gamePlayerId,
          symbol,
          direction: childDirection,
          quantity,
          status: 'working',
          orderType: 'stop',
          timeInForce,
          stopPrice: stopLossPrice!,
          parentTradeId: parent.id,
          bracketRole: 'stop_loss',
          expiresAt: expiresAt ?? null,
        })
        .returning();
      if (!sl) throw new Error('Failed to insert SL child');

      return [rowToWorkingOrder(parent), rowToWorkingOrder(tp), rowToWorkingOrder(sl)];
    }

    const [row] = await tx
      .insert(trades)
      .values({
        gamePlayerId,
        symbol,
        direction,
        quantity,
        status: 'working',
        orderType,
        timeInForce,
        limitPrice: limitPrice ?? null,
        stopPrice: stopPrice ?? null,
        reservedPrice: limitPrice ?? stopPrice ?? input.referencePrice ?? null,
        reservedCash,
        expiresAt: expiresAt ?? null,
      })
      .returning();
    if (!row) throw new Error('Failed to insert working order');
    return [rowToWorkingOrder(row)];
  });
}

/** A working order was not found, or was not owned by the caller. */
export class WorkingOrderNotFoundError extends Error {
  constructor() {
    super('Working order not found');
    this.name = 'WorkingOrderNotFoundError';
  }
}

/**
 * Cancels a working order and reverses its reservation: refunds cash for a
 * buy or restores share count for a sell. If the order is a bracket parent
 * that hasn't filled, the two children are cancelled in the same transaction.
 * Cancelling a bracket child leaves the sibling and parent untouched.
 *
 * @throws {WorkingOrderNotFoundError} if no matching working row exists.
 */
export async function cancelWorkingOrder(
  db: Db,
  gamePlayerId: string,
  tradeId: string,
  reason = 'USER_CANCELLED',
): Promise<{ cancelledIds: string[] }> {
  const { gamePlayers, portfolios, trades } = schema;
  const cancelledIds: string[] = [];

  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(trades)
      .where(
        and(
          eq(trades.id, tradeId),
          eq(trades.gamePlayerId, gamePlayerId),
          eq(trades.status, 'working'),
        ),
      )
      .limit(1);
    if (!row) throw new WorkingOrderNotFoundError();

    await releaseReservation(tx, row);
    const updated = await tx
      .update(trades)
      .set({
        status: 'cancelled',
        cancelledAt: new Date().toISOString(),
        cancelReason: reason,
      })
      .where(and(eq(trades.id, tradeId), eq(trades.status, 'working')))
      .returning({ id: trades.id });
    if (updated.length === 0) throw new WorkingOrderNotFoundError();
    cancelledIds.push(tradeId);

    // If this is a bracket parent that never filled, cancel both children.
    if (row.bracketRole === 'entry') {
      const children = await tx
        .select()
        .from(trades)
        .where(and(eq(trades.parentTradeId, tradeId), eq(trades.status, 'working')));
      for (const c of children) {
        await tx
          .update(trades)
          .set({
            status: 'cancelled',
            cancelledAt: new Date().toISOString(),
            cancelReason: 'PARENT_CANCELLED',
          })
          .where(and(eq(trades.id, c.id), eq(trades.status, 'working')));
        cancelledIds.push(c.id);
      }
    }
  });

  return { cancelledIds };

  /**
   * Refunds cash (buy) or restores shares (sell) for a working row.
   * No-op for bracket children whose parent hasn't filled — their reservation
   * is held on the parent, not the child.
   */
  async function releaseReservation(
    tx: Parameters<Parameters<Db['transaction']>[0]>[0],
    row: TradeRow,
  ): Promise<void> {
    // Bracket children with an unfilled parent hold no reservation of their
    // own — the parent owns it. Skip the refund in that case.
    if (row.parentTradeId != null) {
      const [parent] = await tx
        .select({ status: trades.status })
        .from(trades)
        .where(eq(trades.id, row.parentTradeId))
        .limit(1);
      if (parent?.status !== 'executed') return;
      // Parent already filled — child's reservation is the share/cash
      // implicit from the parent's fill, which we restore below.
    }

    if (row.direction === 'buy' && row.reservedCash != null) {
      const refund = Number(row.reservedCash);
      await tx
        .update(gamePlayers)
        .set({ cashBalance: sql`${gamePlayers.cashBalance} + ${refund}` })
        .where(eq(gamePlayers.id, row.gamePlayerId));
    } else if (row.direction === 'sell') {
      const [holding] = await tx
        .select({ id: portfolios.id, quantity: portfolios.quantity })
        .from(portfolios)
        .where(
          and(
            eq(portfolios.gamePlayerId, row.gamePlayerId),
            eq(portfolios.symbol, row.symbol),
          ),
        )
        .limit(1);
      if (holding) {
        await tx
          .update(portfolios)
          .set({ quantity: holding.quantity + row.quantity })
          .where(eq(portfolios.id, holding.id));
      } else {
        await tx.insert(portfolios).values({
          gamePlayerId: row.gamePlayerId,
          symbol: row.symbol,
          quantity: row.quantity,
          // The reservedPrice carries the order's price hint; for stops we
          // use stopPrice, for limits we use limitPrice — whichever was
          // captured at placement. Fall back to 0 if neither.
          avgCostBasis: Number(row.reservedPrice ?? row.limitPrice ?? row.stopPrice ?? 0),
        });
      }
    }
  }
}

/**
 * Returns true when `quote` satisfies the trigger condition of a working row.
 * Caller is responsible for skipping rows whose parent isn't yet executed.
 */
function isTriggered(row: TradeRow, quote: number): boolean {
  const orderType = row.orderType as OrderType;
  const direction = row.direction as TradeDirection;
  switch (orderType) {
    case 'market':
      // Market bracket-parents fill immediately on the next tick.
      return true;
    case 'limit':
      return direction === 'buy' ? quote <= Number(row.limitPrice) : quote >= Number(row.limitPrice);
    case 'stop':
      return direction === 'buy' ? quote >= Number(row.stopPrice) : quote <= Number(row.stopPrice);
    case 'stop_limit': {
      if (row.stopTriggeredAt == null) {
        return direction === 'buy' ? quote >= Number(row.stopPrice) : quote <= Number(row.stopPrice);
      }
      return direction === 'buy' ? quote <= Number(row.limitPrice) : quote >= Number(row.limitPrice);
    }
    case 'bracket':
      return false;
  }
}

/** Outcome of a single trigger evaluation. */
export type EvaluateOutcome =
  | { kind: 'filled'; trade: Trade; row: TradeRow; result: ExecuteTradeResult }
  | { kind: 'cancelled'; tradeId: string; reason: string; gamePlayerId: string }
  | { kind: 'triggered'; tradeId: string; gamePlayerId: string; triggerPrice: number };

/**
 * Walks every eligible `working` row in active games, fetches a fresh quote
 * per symbol, and:
 *  - fills orders whose trigger condition is met (uses `executeTrade` with
 *    `existingTradeId` so reservations are released atomically),
 *  - flips a stop_limit's `stopTriggeredAt` on first cross (no fill yet —
 *    emits a `triggered` outcome so the caller can broadcast),
 *  - cancels OCO siblings when a bracket child fills,
 *  - cancels resting buys whose fill price exceeded the cash they had
 *    reserved + available (`INSUFFICIENT_FUNDS_AT_FILL`).
 *
 * Concurrency: every state-changing UPDATE is guarded by `status='working'`
 * so a user cancel that beats the worker silently wins.
 */
export async function evaluateTriggers(
  db: Db,
  provider: StockProvider,
): Promise<EvaluateOutcome[]> {
  const { games, trades } = schema;
  const outcomes: EvaluateOutcome[] = [];

  // Pull every working row whose game is active. Bracket children whose
  // parent hasn't filled yet are filtered in JS (cheaper than a self-join
  // here and the volume is small).
  const rows = await db
    .select({
      row: trades,
      gameId: schema.gamePlayers.gameId,
      gameStatus: games.status,
    })
    .from(trades)
    .innerJoin(schema.gamePlayers, eq(trades.gamePlayerId, schema.gamePlayers.id))
    .innerJoin(games, eq(schema.gamePlayers.gameId, games.id))
    .where(and(eq(trades.status, 'working'), eq(games.status, 'active')));

  if (rows.length === 0) return outcomes;

  // Resolve parent statuses for any child rows.
  const parentIds = Array.from(
    new Set(rows.map((r) => r.row.parentTradeId).filter((v): v is string => v != null)),
  );
  const parentStatusById = new Map<string, string>();
  if (parentIds.length > 0) {
    const parents = await db
      .select({ id: trades.id, status: trades.status })
      .from(trades)
      .where(inArray(trades.id, parentIds));
    for (const p of parents) parentStatusById.set(p.id, p.status);
  }

  const eligible = rows.filter(({ row }) => {
    if (row.parentTradeId == null) return true;
    return parentStatusById.get(row.parentTradeId) === 'executed';
  });

  // One quote per symbol, fetched in parallel.
  const symbols = Array.from(new Set(eligible.map((e) => e.row.symbol)));
  const quoteEntries = await Promise.all(
    symbols.map(async (s) => {
      try {
        const q = await provider.getQuote(s);
        return [s, q.price] as const;
      } catch {
        return [s, null] as const;
      }
    }),
  );
  const quoteBySymbol = new Map<string, number>();
  for (const [s, p] of quoteEntries) if (p != null) quoteBySymbol.set(s, p);

  for (const { row } of eligible) {
    const quote = quoteBySymbol.get(row.symbol);
    if (quote == null) continue;
    if (!isTriggered(row, quote)) continue;

    // Stop-limit: first crossing flips stopTriggeredAt; fill happens on a
    // subsequent tick when the limit condition is met.
    if (row.orderType === 'stop_limit' && row.stopTriggeredAt == null) {
      const triggeredAt = new Date().toISOString();
      const updated = await db
        .update(trades)
        .set({ stopTriggeredAt: triggeredAt })
        .where(and(eq(trades.id, row.id), eq(trades.status, 'working'), isNull(trades.stopTriggeredAt)))
        .returning({ id: trades.id });
      if (updated.length > 0) {
        outcomes.push({
          kind: 'triggered',
          tradeId: row.id,
          gamePlayerId: row.gamePlayerId,
          triggerPrice: quote,
        });
      }
      continue;
    }

    // Attempt the fill. The price is the triggering quote, per the design
    // decision (real-exchange "next available" semantics).
    try {
      const result = await executeTrade(db, {
        gamePlayerId: row.gamePlayerId,
        symbol: row.symbol,
        direction: row.direction as TradeDirection,
        quantity: row.quantity,
        price: quote,
        existingTradeId: row.id,
        reservedCash: row.reservedCash == null ? 0 : Number(row.reservedCash),
      });
      outcomes.push({ kind: 'filled', trade: result.trade, row, result });

      // OCO: if this was a bracket child, cancel its sibling. Same transaction
      // is not strictly required because each side's guard predicate
      // (`status='working'`) makes the cancel race-safe.
      if (row.parentTradeId != null && row.bracketRole != null && row.bracketRole !== 'entry') {
        const siblings = await db
          .select({ id: trades.id })
          .from(trades)
          .where(
            and(
              eq(trades.parentTradeId, row.parentTradeId),
              eq(trades.status, 'working'),
              // any non-self
              sql`${trades.id} != ${row.id}`,
            ),
          );
        for (const s of siblings) {
          const upd = await db
            .update(trades)
            .set({
              status: 'cancelled',
              cancelledAt: new Date().toISOString(),
              cancelReason: 'OCO_SIBLING_FILLED',
            })
            .where(and(eq(trades.id, s.id), eq(trades.status, 'working')))
            .returning({ id: trades.id });
          if (upd.length > 0) {
            outcomes.push({
              kind: 'cancelled',
              tradeId: s.id,
              reason: 'OCO_SIBLING_FILLED',
              gamePlayerId: row.gamePlayerId,
            });
          }
        }
      }

      // Bracket parent fill activates children — they are already `working`,
      // so no state change is needed. The next tick will pick them up.
    } catch (err) {
      if (err instanceof TradeError) {
        if (
          err.code === 'INSUFFICIENT_FUNDS' ||
          err.code === 'INSUFFICIENT_SHARES' ||
          err.code === 'INSUFFICIENT_FUNDS_AT_FILL'
        ) {
          // Cancel this row with reservation refund.
          const reason =
            err.code === 'INSUFFICIENT_SHARES'
              ? 'INSUFFICIENT_SHARES_AT_FILL'
              : 'INSUFFICIENT_FUNDS_AT_FILL';
          try {
            await cancelWorkingOrder(db, row.gamePlayerId, row.id, reason);
            outcomes.push({
              kind: 'cancelled',
              tradeId: row.id,
              reason,
              gamePlayerId: row.gamePlayerId,
            });
          } catch {
            // Already cancelled by a concurrent request — ignore.
          }
        } else if (err.code === 'ORDER_NOT_WORKING') {
          // Concurrent user cancel won the race — silent skip.
          continue;
        } else {
          // Unrecognized — re-throw so the worker logs it.
          throw err;
        }
      } else {
        throw err;
      }
    }
  }

  return outcomes;
}

/**
 * Marks every `working` or `pending` order whose `expiresAt` is in the past
 * as cancelled, releasing reservations. Called at the top of each worker tick.
 */
export async function expireDayOrders(
  db: Db,
  now = new Date().toISOString(),
): Promise<{ cancelledIds: string[] }> {
  const { trades } = schema;
  const expired = await db
    .select()
    .from(trades)
    .where(
      and(
        or(eq(trades.status, 'working'), eq(trades.status, 'pending')),
        sql`${trades.expiresAt} IS NOT NULL`,
        sql`${trades.expiresAt} < ${now}`,
      ),
    );

  const cancelledIds: string[] = [];
  for (const row of expired) {
    try {
      const result = await cancelWorkingOrder(db, row.gamePlayerId, row.id, 'TIF_EXPIRED');
      cancelledIds.push(...result.cancelledIds);
    } catch (err) {
      if (err instanceof WorkingOrderNotFoundError) continue;
      throw err;
    }
  }
  return { cancelledIds };
}

/**
 * Lists working orders for a player. By default returns all open orders;
 * pass `{ openOnly: false }` to include executed/cancelled in placedAt order.
 */
export async function listWorkingOrders(
  db: Db,
  gamePlayerId: string,
): Promise<WorkingOrder[]> {
  const { trades } = schema;
  const rows = await db
    .select()
    .from(trades)
    .where(and(eq(trades.gamePlayerId, gamePlayerId), eq(trades.status, 'working')));
  return rows
    .sort((a, b) => a.placedAt.localeCompare(b.placedAt))
    .map(rowToWorkingOrder);
}

/**
 * Returns the distinct symbols that have at least one open order (working or
 * pending) in an active game. Used by the price-poller to make sure stops/
 * limits get evaluated even when their owner is offline.
 */
export async function getOpenOrderSymbols(db: Db): Promise<string[]> {
  const { games, trades } = schema;
  const rows = await db
    .selectDistinct({ symbol: trades.symbol })
    .from(trades)
    .innerJoin(schema.gamePlayers, eq(trades.gamePlayerId, schema.gamePlayers.id))
    .innerJoin(games, eq(schema.gamePlayers.gameId, games.id))
    .where(
      and(
        eq(games.status, 'active'),
        or(eq(trades.status, 'working'), eq(trades.status, 'pending')),
      ),
    );
  return rows.map((r) => r.symbol);
}
