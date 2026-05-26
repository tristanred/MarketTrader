import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import type { StockProvider } from '../providers/index.js';
import type { MarketStatusProvider } from '../providers/market-status/index.js';
import { settlePendingTrades } from '../services/pending-trade.js';
import { evaluateTriggers, expireDayOrders } from '../services/working-order.js';
import { recordSnapshot } from '../services/portfolio-snapshot.js';
import { emitTradeEvents } from '../services/trade-emit.js';
import type { GameClientRegistry } from '../ws/registry.js';
import type { EventBus } from '../events/bus.js';
import { env } from '../env.js';
import type { MarketState, TradeDirection } from '@markettrader/shared';

/** Whether the configured policy treats a given market state as "open" for settlement. */
function isTradingOpen(state: MarketState): boolean {
  if (state === 'REGULAR') return true;
  if (!env.MARKET_HOURS_INCLUDE_EXTENDED) return false;
  return state === 'PRE' || state === 'POST';
}

/**
 * One tick of the pending-orders worker. Does, in order:
 *  1. Expire day-TIF orders whose `expiresAt` has passed (always; not gated on
 *     market state — a day order that died overnight should be cancelled at
 *     the next tick regardless of whether the market is currently open).
 *  2. Settle market-hours pending orders (existing behaviour; gated on market open).
 *  3. Evaluate triggers for resting limit/stop/bracket orders (gated on market
 *     open — we don't fire stops on stale data when the market is closed).
 *  4. Broadcast `trade_executed`, `order_cancelled`, `order_triggered` events
 *     and a per-game `leaderboard_update`.
 */
export async function runPendingOrdersTick(deps: {
  db: Db;
  provider: StockProvider;
  marketStatusProvider: MarketStatusProvider;
  registry?: GameClientRegistry;
  bus?: EventBus;
  logger?: FastifyBaseLogger;
}): Promise<void> {
  const { db, provider, marketStatusProvider, registry, bus, logger } = deps;
  const { gamePlayers, portfolios } = schema;

  // Synthesize an ExecuteTradeResult for settle-path fills (which don't go
  // through executeTrade) so emitTradeEvents has the shape it expects. P&L
  // and hold-duration are zeroed because the cost basis was lost when the
  // sell was queued — see docs/design.md "Known gap: resting-sell realized
  // P&L". The isResting flag at the call site suppresses position.closed.
  async function countDistinctSymbols(gamePlayerId: string): Promise<number> {
    const rows = await db
      .select({ id: portfolios.id })
      .from(portfolios)
      .where(eq(portfolios.gamePlayerId, gamePlayerId));
    return rows.length;
  }

  // Step 1: expire day-TIF orders. Cheap and side-effect-only on the DB.
  let expired: { cancelledIds: string[] } = { cancelledIds: [] };
  try {
    expired = await expireDayOrders(db);
  } catch {
    // Swallow — a failed expiry must not block settlement.
  }

  let state: MarketState | null = null;
  try {
    state = (await marketStatusProvider.getStatus()).state;
  } catch {
    // If we can't determine market state, fall through to "closed" semantics
    // for steps 2 and 3 — better than firing stops on stale data.
  }
  const marketOpen = state != null && isTradingOpen(state);

  const settleOutcomes = marketOpen ? await settlePendingTrades(db, provider) : [];
  const triggerOutcomes = marketOpen ? await evaluateTriggers(db, provider) : [];

  if (!registry && !bus) return;

  const gameIdsTouched = new Set<string>();
  const playerCache = new Map<string, { gameId: string; userId: string }>();
  async function resolvePlayer(gamePlayerId: string) {
    const cached = playerCache.get(gamePlayerId);
    if (cached) return cached;
    const [row] = await db
      .select({ gameId: gamePlayers.gameId, userId: gamePlayers.userId })
      .from(gamePlayers)
      .where(eq(gamePlayers.id, gamePlayerId))
      .limit(1);
    if (!row) return null;
    playerCache.set(gamePlayerId, row);
    return row;
  }

  // Broadcasts: settled market-pending fills.
  for (const o of settleOutcomes) {
    if (o.kind !== 'executed') continue;
    const player = await resolvePlayer(o.trade.gamePlayerId);
    if (!player) continue;
    gameIdsTouched.add(player.gameId);
    registry?.broadcast(player.gameId, {
      event: 'trade_executed',
      data: {
        playerId: player.userId,
        symbol: o.trade.symbol,
        direction: o.trade.direction as TradeDirection,
        quantity: o.trade.quantity,
        price: o.trade.price,
        executedAt: o.trade.executedAt,
      },
    });
    if (bus) {
      void bus.emit({
        type: 'trade.executed',
        gameId: player.gameId,
        gamePlayerId: o.trade.gamePlayerId,
        symbol: o.trade.symbol,
        direction: o.trade.direction as 'buy' | 'sell',
        quantity: o.trade.quantity,
        price: o.trade.price,
        tradeId: o.trade.id,
        executedAt: o.trade.executedAt,
      });
      const [updated] = await db
        .select({ cashBalance: gamePlayers.cashBalance })
        .from(gamePlayers)
        .where(eq(gamePlayers.id, o.trade.gamePlayerId))
        .limit(1);
      const distinctSymbols = await countDistinctSymbols(o.trade.gamePlayerId);
      void emitTradeEvents({
        bus,
        db,
        provider,
        gameId: player.gameId,
        gamePlayerId: o.trade.gamePlayerId,
        cashAfter: Number(updated?.cashBalance ?? 0),
        symbol: o.trade.symbol,
        direction: o.trade.direction as 'buy' | 'sell',
        quantity: o.trade.quantity,
        result: {
          trade: o.trade,
          realizedPnl: 0,
          realizedPnlPct: 0,
          holdDurationMs: 0,
          fullyClosed: false,
          distinctSymbols,
        },
        executedAt: o.trade.executedAt,
        isResting: true,
      }).catch((err) => {
        logger?.error({ err }, 'failed to emit trade follow-on events (settle)');
      });
    }
  }

  // Broadcasts: trigger evaluator outcomes (limit/stop fills, OCO cancels, stop_limit triggers).
  for (const o of triggerOutcomes) {
    const gamePlayerId =
      o.kind === 'filled' ? o.row.gamePlayerId : o.gamePlayerId;
    const player = await resolvePlayer(gamePlayerId);
    if (!player) continue;
    gameIdsTouched.add(player.gameId);

    if (o.kind === 'filled') {
      registry?.broadcast(player.gameId, {
        event: 'trade_executed',
        data: {
          playerId: player.userId,
          symbol: o.trade.symbol,
          direction: o.trade.direction as TradeDirection,
          quantity: o.trade.quantity,
          price: o.trade.price,
          executedAt: o.trade.executedAt,
        },
      });
      if (bus) {
        void bus.emit({
          type: 'trade.executed',
          gameId: player.gameId,
          gamePlayerId: o.row.gamePlayerId,
          symbol: o.trade.symbol,
          direction: o.trade.direction as 'buy' | 'sell',
          quantity: o.trade.quantity,
          price: o.trade.price,
          tradeId: o.trade.id,
          executedAt: o.trade.executedAt,
        });
        const [updated] = await db
          .select({ cashBalance: gamePlayers.cashBalance })
          .from(gamePlayers)
          .where(eq(gamePlayers.id, o.row.gamePlayerId))
          .limit(1);
        // Triggered fills are always resting orders — suppress position.closed
        // on sells (cost basis was lost at placement). Buys still emit
        // holdings.changed with accurate metrics; their distinctSymbols and
        // openedAt are tracked correctly inside executeTrade.
        void emitTradeEvents({
          bus,
          db,
          provider,
          gameId: player.gameId,
          gamePlayerId: o.row.gamePlayerId,
          cashAfter: Number(updated?.cashBalance ?? 0),
          symbol: o.trade.symbol,
          direction: o.trade.direction as 'buy' | 'sell',
          quantity: o.trade.quantity,
          result: o.result,
          executedAt: o.trade.executedAt,
          isResting: true,
        }).catch((err) => {
          logger?.error({ err }, 'failed to emit trade follow-on events (trigger)');
        });
      }
    } else if (o.kind === 'cancelled') {
      registry?.broadcast(player.gameId, {
        event: 'order_cancelled',
        data: { playerId: player.userId, tradeId: o.tradeId, reason: o.reason },
      });
    } else {
      registry?.broadcast(player.gameId, {
        event: 'order_triggered',
        data: {
          playerId: player.userId,
          tradeId: o.tradeId,
          triggerPrice: o.triggerPrice,
        },
      });
    }
  }

  // Broadcasts: TIF expiry cancellations.
  for (const tradeId of expired.cancelledIds) {
    // Look up the player by trade id (small N — only the rows we cancelled this tick).
    const [t] = await db
      .select({ gamePlayerId: schema.trades.gamePlayerId })
      .from(schema.trades)
      .where(eq(schema.trades.id, tradeId))
      .limit(1);
    if (!t) continue;
    const player = await resolvePlayer(t.gamePlayerId);
    if (!player) continue;
    gameIdsTouched.add(player.gameId);
    registry?.broadcast(player.gameId, {
      event: 'order_cancelled',
      data: { playerId: player.userId, tradeId, reason: 'TIF_EXPIRED' },
    });
  }

  // One leaderboard refresh per touched game. recordSnapshot internally calls
  // computeLeaderboard and writes a portfolio_snapshots row per player, so the
  // chart sees a fresh point at every settle without a second leaderboard query.
  for (const gameId of gameIdsTouched) {
    try {
      const entries = await recordSnapshot(db, gameId, bus);
      registry?.broadcast(gameId, { event: 'leaderboard_update', data: entries });
    } catch {
      // Swallow — a failed leaderboard broadcast must not affect settlement.
    }
  }
}

/**
 * Starts the pending-orders settlement loop. Returns a stop handle. Re-entrancy
 * is guarded: if a tick is still running when the next interval fires, the new
 * tick is skipped.
 */
export function startPendingOrdersWorker(deps: {
  db: Db;
  provider: StockProvider;
  marketStatusProvider: MarketStatusProvider;
  registry?: GameClientRegistry;
  bus?: EventBus;
  logger?: FastifyBaseLogger;
  intervalMs?: number;
}): { stop: () => void } {
  const intervalMs = deps.intervalMs ?? env.PENDING_ORDERS_TICK_MS;
  let running = false;
  const handle = setInterval(() => {
    if (running) return;
    running = true;
    runPendingOrdersTick(deps)
      .catch((err) => {
        deps.logger?.error({ err }, 'pending-orders tick failed');
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  return {
    stop: () => clearInterval(handle),
  };
}
