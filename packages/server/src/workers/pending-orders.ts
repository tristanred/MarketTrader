import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import type { StockProvider } from '../providers/index.js';
import type { MarketStatusProvider } from '../providers/market-status/index.js';
import { settlePendingTrades } from '../services/pending-trade.js';
import { computeLeaderboard } from '../services/leaderboard.js';
import type { GameClientRegistry } from '../ws/registry.js';
import { env } from '../env.js';
import type { MarketState, TradeDirection } from '@markettrader/shared';

/** Whether the configured policy treats a given market state as "open" for settlement. */
function isTradingOpen(state: MarketState): boolean {
  if (state === 'REGULAR') return true;
  if (!env.MARKET_HOURS_INCLUDE_EXTENDED) return false;
  return state === 'PRE' || state === 'POST';
}

/** Settles every eligible pending trade and broadcasts the resulting executions. */
export async function runPendingOrdersTick(deps: {
  db: Db;
  provider: StockProvider;
  marketStatusProvider: MarketStatusProvider;
  registry?: GameClientRegistry;
}): Promise<void> {
  const { db, provider, marketStatusProvider, registry } = deps;

  let state: MarketState;
  try {
    state = (await marketStatusProvider.getStatus()).state;
  } catch {
    return;
  }
  if (!isTradingOpen(state)) return;

  const outcomes = await settlePendingTrades(db, provider);
  if (outcomes.length === 0 || !registry) return;

  // Map each executed trade back to its (gameId, userId) so we can broadcast.
  const executed = outcomes.filter(
    (o): o is Extract<typeof o, { kind: 'executed' }> => o.kind === 'executed',
  );
  if (executed.length === 0) return;

  const { gamePlayers } = schema;
  const gameIdsTouched = new Set<string>();
  for (const o of executed) {
    const [player] = await db
      .select({ gameId: gamePlayers.gameId, userId: gamePlayers.userId })
      .from(gamePlayers)
      .where(eq(gamePlayers.id, o.trade.gamePlayerId))
      .limit(1);
    if (!player) continue;
    gameIdsTouched.add(player.gameId);
    registry.broadcast(player.gameId, {
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
  }

  // One leaderboard refresh per touched game.
  for (const gameId of gameIdsTouched) {
    try {
      const entries = await computeLeaderboard(db, gameId);
      registry.broadcast(gameId, { event: 'leaderboard_update', data: entries });
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
