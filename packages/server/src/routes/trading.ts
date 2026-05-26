import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { eq, and, desc } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import type { StockProvider } from '../providers/index.js';
import { StockProviderError, TradeError } from '../providers/index.js';
import type { MarketStatusProvider } from '../providers/market-status/index.js';
import type { MarketState } from '@markettrader/shared';
import { recomputeGameStatus } from '../services/game-status.js';
import { executeTrade } from '../services/trade.js';
import { loadPlayerPortfolio } from '../services/portfolio.js';
import {
  reservePendingTrade,
  listPendingTrades,
  cancelPendingTrade,
  PendingTradeNotFoundError,
} from '../services/pending-trade.js';
import {
  placeWorkingOrder,
  cancelWorkingOrder,
  listWorkingOrders,
  WorkingOrderNotFoundError,
} from '../services/working-order.js';
import type { OrderType, TimeInForce } from '@markettrader/shared';
import { recordSnapshot } from '../services/portfolio-snapshot.js';
import type { TradeDirection } from '@markettrader/shared';
import type { GameClientRegistry } from '../ws/registry.js';
import type { EventBus } from '../events/bus.js';
import { env } from '../env.js';

/** Returns whether the configured policy treats this market state as "open" for trading. */
function isTradingOpen(state: MarketState): boolean {
  if (state === 'REGULAR') return true;
  if (!env.MARKET_HOURS_INCLUDE_EXTENDED) return false;
  return state === 'PRE' || state === 'POST';
}

const LEADERBOARD_THROTTLE_MS = 1_000;

const placeTradeSchema = z
  .object({
    symbol: z.string().min(1).max(10).transform((s) => s.toUpperCase()),
    direction: z.enum(['buy', 'sell']),
    quantity: z.number().int().min(1),
    orderType: z
      .enum(['market', 'limit', 'stop', 'stop_limit', 'bracket'])
      .optional()
      .default('market'),
    timeInForce: z.enum(['day', 'gtc']).optional().default('day'),
    limitPrice: z.number().positive().optional(),
    stopPrice: z.number().positive().optional(),
    takeProfitPrice: z.number().positive().optional(),
    stopLossPrice: z.number().positive().optional(),
  })
  .superRefine((v, ctx) => {
    if ((v.orderType === 'limit' || v.orderType === 'stop_limit') && v.limitPrice == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'limitPrice is required for limit and stop_limit orders',
        path: ['limitPrice'],
      });
    }
    if ((v.orderType === 'stop' || v.orderType === 'stop_limit') && v.stopPrice == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'stopPrice is required for stop and stop_limit orders',
        path: ['stopPrice'],
      });
    }
    if (v.orderType === 'bracket' && (v.takeProfitPrice == null || v.stopLossPrice == null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'bracket orders require takeProfitPrice and stopLossPrice',
        path: ['orderType'],
      });
    }
    if (v.orderType === 'market' && (v.limitPrice != null || v.stopPrice != null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'market orders must not include limitPrice or stopPrice',
        path: ['orderType'],
      });
    }
  });

const gameIdParamsSchema = z.object({ id: z.string() });
const pendingTradeParamsSchema = z.object({ id: z.string(), pendingId: z.string() });
const workingOrderParamsSchema = z.object({ id: z.string(), tradeId: z.string() });
const tradesQuerySchema = z.object({
  status: z.enum(['executed', 'working', 'pending']).optional(),
});

/**
 * Registers trading and portfolio routes (all require authentication):
 * - `POST /games/:id/trades`     — execute a buy or sell at the live market price.
 * - `GET  /games/:id/trades`     — trade history for the caller in this game, newest first.
 * - `GET  /games/:id/portfolio`  — current holdings enriched with live prices and P&L.
 *
 * When a registry is provided, `trade_executed` and `leaderboard_update` WebSocket
 * events are broadcast to all connected clients in the game. The leaderboard broadcast
 * is throttled to at most once per second per game (map lives in this closure).
 */
export function tradingRoutes(
  db: Db,
  provider: StockProvider,
  marketStatusProvider: MarketStatusProvider,
  registry?: GameClientRegistry,
  leaderboardThrottleMs = LEADERBOARD_THROTTLE_MS,
  bus?: EventBus,
) {
  // Per-game leaderboard throttle: gameId → timestamp of last broadcast (ms)
  const lastLeaderboardBroadcast = new Map<string, number>();

  return async function (rawApp: FastifyInstance): Promise<void> {
    const app = rawApp.withTypeProvider<ZodTypeProvider>();
    const { games, gamePlayers, trades } = schema;

    app.post(
      '/games/:id/trades',
      {
        onRequest: rawApp.authenticate,
        config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
        schema: {
          tags: ['Trading'],
          summary: 'Execute a buy or sell at the live market price.',
          security: [{ bearerAuth: [] }],
          params: gameIdParamsSchema,
          body: placeTradeSchema,
        },
      },
      async (request, reply) => {
        const {
          symbol,
          direction,
          quantity,
          orderType,
          timeInForce,
          limitPrice,
          stopPrice,
          takeProfitPrice,
          stopLossPrice,
        } = request.body;
        const userId = request.user.id;
        const gameId = request.params.id;

        const [game] = await db
          .select()
          .from(games)
          .where(eq(games.id, gameId))
          .limit(1);
        if (!game) return reply.status(404).send({ error: 'Game not found' });

        // Defensive: when shorts are wired into TradeDirection later, this
        // gate enforces the per-game `allowShortSelling` setting. Today the
        // Zod enum only admits buy/sell, so the predicate is unreachable —
        // kept here so future additions to the direction enum can't bypass
        // the per-game flag without an obvious test failure.
        const isShortDirection: boolean = (
          ['sell-short', 'buy-to-cover'] as readonly string[]
        ).includes(direction);
        if (isShortDirection && !game.allowShortSelling) {
          return reply
            .status(403)
            .send({ error: 'SHORT_SELLING_DISABLED', message: 'Short selling is not allowed in this game' });
        }

        // Per-game order-type gates. Mirrors the allowShortSelling pattern.
        if ((orderType === 'limit' || orderType === 'stop_limit') && !game.allowLimitOrders) {
          return reply
            .status(409)
            .send({ code: 'LIMIT_ORDERS_DISABLED', message: 'Limit orders are not allowed in this game' });
        }
        if ((orderType === 'stop' || orderType === 'stop_limit') && !game.allowStopOrders) {
          return reply
            .status(409)
            .send({ code: 'STOP_ORDERS_DISABLED', message: 'Stop orders are not allowed in this game' });
        }
        if (orderType === 'bracket' && !game.allowBracketOrders) {
          return reply
            .status(409)
            .send({ code: 'BRACKET_ORDERS_DISABLED', message: 'Bracket orders are not allowed in this game' });
        }
        if (timeInForce === 'gtc' && !game.allowGTC) {
          return reply
            .status(409)
            .send({ code: 'GTC_DISABLED', message: 'Good-Til-Cancelled orders are not allowed in this game' });
        }

        const status = await recomputeGameStatus(db, game, new Date().toISOString(), bus);
        if (status !== 'active') {
          return reply.status(409).send({ error: 'GAME_NOT_ACTIVE', message: `Game is ${status}` });
        }

        const [gamePlayer] = await db
          .select()
          .from(gamePlayers)
          .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.userId, userId)))
          .limit(1);
        if (!gamePlayer) return reply.status(404).send({ error: 'You are not a member of this game' });

        // ── Working-order branch ─────────────────────────────────────────────
        // Non-market orders are placed as resting working orders. The trigger
        // worker fills them when the price condition is met.
        if (orderType !== 'market') {
          // Fetch a reference quote for stops (no limit ceiling) and brackets
          // with a market entry. Best-effort: if it fails, the service will
          // throw INVALID_ORDER for cases that need it.
          let referencePrice: number | undefined;
          try {
            const q = await provider.getQuote(symbol);
            referencePrice = q.price;
          } catch {
            // Stop and market-bracket entries that need a reference price
            // will be rejected by placeWorkingOrder with INVALID_ORDER.
          }
          try {
            const orders = await placeWorkingOrder(db, {
              gamePlayerId: gamePlayer.id,
              symbol,
              direction: direction as TradeDirection,
              quantity,
              orderType: orderType as OrderType,
              timeInForce: timeInForce as TimeInForce,
              ...(limitPrice != null && { limitPrice }),
              ...(stopPrice != null && { stopPrice }),
              ...(takeProfitPrice != null && { takeProfitPrice }),
              ...(stopLossPrice != null && { stopLossPrice }),
              ...(referencePrice != null && { referencePrice }),
            });
            if (registry) {
              for (const order of orders) {
                registry.broadcast(gameId, {
                  event: 'order_placed',
                  data: { playerId: gamePlayer.userId, order },
                });
              }
            }
            return reply.status(202).send({ orders });
          } catch (err) {
            if (err instanceof TradeError) {
              return reply.status(422).send({ code: err.code, message: err.message });
            }
            throw err;
          }
        }

        // ── Market-hours gate ────────────────────────────────────────────────
        // Default mode `instant` falls through to the existing logic for
        // backwards compatibility. `disabled` rejects out-of-hours; `pending`
        // queues the order for settlement at next market open.
        if (env.MARKET_HOURS_MODE !== 'instant') {
          let marketState: MarketState | null = null;
          try {
            const ms = await marketStatusProvider.getStatus();
            marketState = ms.state;
          } catch {
            // If we can't determine market state, fall through to instant
            // semantics — better to accept the trade than to silently break
            // when the upstream is flaky. Operators who care can set the
            // static provider for a guaranteed answer.
          }

          if (marketState !== null && !isTradingOpen(marketState)) {
            if (env.MARKET_HOURS_MODE === 'disabled') {
              return reply.status(409).send({
                code: 'MARKET_CLOSED',
                message: 'Market is closed and pending orders are disabled on this server.',
              });
            }
            // MARKET_HOURS_MODE === 'pending': reserve and queue.
            let reservedQuote;
            try {
              reservedQuote = await provider.getQuote(symbol);
            } catch (err) {
              if (err instanceof StockProviderError) {
                if (err.code === 'SYMBOL_NOT_FOUND') {
                  return reply.status(404).send({ error: err.message });
                }
                return reply.status(502).send({ error: err.message });
              }
              throw err;
            }
            try {
              const pending = await reservePendingTrade(db, {
                gamePlayerId: gamePlayer.id,
                symbol,
                direction: direction as TradeDirection,
                quantity,
                reservedPrice: reservedQuote.price,
              });
              return reply.status(202).send({ pending });
            } catch (err) {
              if (err instanceof TradeError) {
                return reply.status(422).send({ code: err.code, message: err.message });
              }
              throw err;
            }
          }
        }

        let quote;
        try {
          quote = await provider.getQuote(symbol);
        } catch (err) {
          if (err instanceof StockProviderError) {
            if (err.code === 'SYMBOL_NOT_FOUND') return reply.status(404).send({ error: err.message });
            if (err.code === 'RATE_LIMITED') {
              reply.header('Retry-After', Math.ceil(env.STOCK_RATE_LIMIT_BACKOFF_MS / 1000));
              return reply.status(429).send({
                code: 'RATE_LIMITED',
                message: 'Live quote unavailable; market data is rate-limited. Try again in a minute.',
              });
            }
            return reply.status(502).send({ error: err.message });
          }
          throw err;
        }

        // Stale-price gate. CachedProvider sets `stale:true` when it fell back
        // to a cache row because the live provider was rate-limited.
        let priceAgeMs = 0;
        if (quote.stale === true) {
          priceAgeMs = Date.now() - new Date(quote.fetchedAt).getTime();
          if (!env.STOCK_ALLOW_STALE_TRADES) {
            return reply.status(409).send({
              code: 'STALE_PRICE_BLOCKED',
              message:
                'Live quote unavailable and stale-price trades are disabled on this server. Try again in a minute.',
            });
          }
          if (priceAgeMs > env.STOCK_STALE_TRADE_MAX_AGE_MS) {
            return reply.status(409).send({
              code: 'STALE_PRICE_TOO_OLD',
              message: `Last known price is ${Math.round(priceAgeMs / 1000)}s old; refusing to trade.`,
            });
          }
        }

        let trade;
        // `_result` holds the full ExecuteTradeResult so Task 9 can wire
        // derived metrics (realizedPnl, distinctSymbols, ...) into emits.
        let _result;
        try {
          _result = await executeTrade(db, {
            gamePlayerId: gamePlayer.id,
            symbol,
            direction: direction as TradeDirection,
            quantity,
            price: quote.price,
          });
          trade = _result.trade;
        } catch (err) {
          if (err instanceof TradeError) {
            return reply.status(422).send({ code: err.code, message: err.message });
          }
          throw err;
        }

        const [updatedPlayer] = await db
          .select({ cashBalance: gamePlayers.cashBalance })
          .from(gamePlayers)
          .where(eq(gamePlayers.id, gamePlayer.id))
          .limit(1);

        // Emit on the in-process bus for achievement (and future) consumers.
        // Decoupled from the WS broadcast so the engine still runs in tests
        // that don't provide a `registry`.
        if (bus) {
          void bus.emit({
            type: 'trade.executed',
            gameId,
            gamePlayerId: gamePlayer.id,
            symbol: trade.symbol,
            direction: trade.direction as 'buy' | 'sell',
            quantity: trade.quantity,
            price: Number(trade.price),
            tradeId: trade.id,
            executedAt: trade.executedAt!,
          });
        }

        // ── WebSocket broadcasts ──────────────────────────────────────────────
        if (registry) {
          // Immediate: notify all game clients that a trade occurred
          registry.broadcast(gameId, {
            event: 'trade_executed',
            data: {
              playerId: gamePlayer.userId,
              symbol: trade.symbol,
              direction: trade.direction as TradeDirection,
              quantity: trade.quantity,
              price: Number(trade.price),
              executedAt: trade.executedAt!,
            },
          });

          // Throttled: leaderboard may recompute at most once per second per game
          const now = Date.now();
          const last = lastLeaderboardBroadcast.get(gameId) ?? 0;
          if (now - last >= leaderboardThrottleMs) {
            lastLeaderboardBroadcast.set(gameId, now);
            // Fire-and-forget — do not delay the HTTP response.
            // recordSnapshot internally calls computeLeaderboard once and uses
            // the result for both the WS broadcast and the snapshot rows, so
            // there's no double work here.
            recordSnapshot(db, gameId, bus)
              .then((entries) => {
                registry.broadcast(gameId, { event: 'leaderboard_update', data: entries });
              })
              .catch(() => {
                // Swallow — a failed leaderboard broadcast must not affect the HTTP response
              });
          }
        }

        const responseBody: {
          trade: typeof trade;
          cashBalance: number;
          priceWasStale?: true;
          priceAgeMs?: number;
        } = {
          trade,
          cashBalance: Number(updatedPlayer?.cashBalance ?? 0),
        };
        if (quote.stale === true) {
          responseBody.priceWasStale = true;
          responseBody.priceAgeMs = priceAgeMs;
        }

        return reply.status(201).send(responseBody);
      },
    );

    app.get(
      '/games/:id/trades',
      {
        onRequest: rawApp.authenticate,
        schema: {
          tags: ['Trading'],
          summary: 'Trade history for the caller. Defaults to executed; pass ?status=working for resting orders.',
          security: [{ bearerAuth: [] }],
          params: gameIdParamsSchema,
          querystring: tradesQuerySchema,
        },
      },
      async (request, reply) => {
        const userId = request.user.id;
        const gameId = request.params.id;
        const statusFilter = request.query.status ?? 'executed';

        const [gamePlayer] = await db
          .select({ id: gamePlayers.id })
          .from(gamePlayers)
          .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.userId, userId)))
          .limit(1);
        if (!gamePlayer) return reply.status(404).send({ error: 'You are not a member of this game' });

        if (statusFilter === 'working') {
          const list = await listWorkingOrders(db, gamePlayer.id);
          return reply.status(200).send(list);
        }
        if (statusFilter === 'pending') {
          const list = await listPendingTrades(db, gamePlayer.id);
          return reply.status(200).send(list);
        }

        const history = await db
          .select()
          .from(trades)
          .where(and(eq(trades.gamePlayerId, gamePlayer.id), eq(trades.status, 'executed')))
          .orderBy(desc(trades.executedAt));

        return reply.status(200).send(
          history.map((t) => ({
            id: t.id,
            gamePlayerId: t.gamePlayerId,
            symbol: t.symbol,
            direction: t.direction,
            quantity: t.quantity,
            price: Number(t.price),
            executedAt: t.executedAt,
          })),
        );
      },
    );

    app.delete(
      '/games/:id/trades/:tradeId',
      {
        onRequest: rawApp.authenticate,
        schema: {
          tags: ['Trading'],
          summary: 'Cancel a resting working order (limit/stop/bracket).',
          security: [{ bearerAuth: [] }],
          params: workingOrderParamsSchema,
        },
      },
      async (request, reply) => {
        const userId = request.user.id;
        const gameId = request.params.id;
        const tradeId = request.params.tradeId;

        const [gamePlayer] = await db
          .select({ id: gamePlayers.id, userId: gamePlayers.userId })
          .from(gamePlayers)
          .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.userId, userId)))
          .limit(1);
        if (!gamePlayer) return reply.status(404).send({ error: 'You are not a member of this game' });

        try {
          const { cancelledIds } = await cancelWorkingOrder(db, gamePlayer.id, tradeId);
          if (registry) {
            for (const id of cancelledIds) {
              registry.broadcast(gameId, {
                event: 'order_cancelled',
                data: { playerId: gamePlayer.userId, tradeId: id, reason: 'USER_CANCELLED' },
              });
            }
          }
          return reply.status(204).send();
        } catch (err) {
          if (err instanceof WorkingOrderNotFoundError) {
            return reply.status(404).send({ error: 'Working order not found' });
          }
          throw err;
        }
      },
    );

    app.get(
      '/games/:id/trades/pending',
      {
        onRequest: rawApp.authenticate,
        schema: {
          tags: ['Trading'],
          summary: 'List the caller\'s pending (queued) trades for this game.',
          security: [{ bearerAuth: [] }],
          params: gameIdParamsSchema,
        },
      },
      async (request, reply) => {
        const userId = request.user.id;
        const gameId = request.params.id;

        const [gamePlayer] = await db
          .select({ id: gamePlayers.id })
          .from(gamePlayers)
          .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.userId, userId)))
          .limit(1);
        if (!gamePlayer) return reply.status(404).send({ error: 'You are not a member of this game' });

        const pending = await listPendingTrades(db, gamePlayer.id);
        return reply.status(200).send(pending);
      },
    );

    app.delete(
      '/games/:id/trades/pending/:pendingId',
      {
        onRequest: rawApp.authenticate,
        schema: {
          tags: ['Trading'],
          summary: 'Cancel a pending trade.',
          security: [{ bearerAuth: [] }],
          params: pendingTradeParamsSchema,
        },
      },
      async (request, reply) => {
        const userId = request.user.id;
        const gameId = request.params.id;
        const pendingId = request.params.pendingId;

        const [gamePlayer] = await db
          .select({ id: gamePlayers.id })
          .from(gamePlayers)
          .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.userId, userId)))
          .limit(1);
        if (!gamePlayer) return reply.status(404).send({ error: 'You are not a member of this game' });

        try {
          await cancelPendingTrade(db, gamePlayer.id, pendingId);
        } catch (err) {
          if (err instanceof PendingTradeNotFoundError) {
            return reply.status(404).send({ error: 'Pending trade not found' });
          }
          throw err;
        }
        return reply.status(204).send();
      },
    );

    app.get(
      '/games/:id/portfolio',
      {
        onRequest: rawApp.authenticate,
        schema: {
          tags: ['Trading'],
          summary: 'Current holdings enriched with live prices and unrealized P&L.',
          security: [{ bearerAuth: [] }],
          params: gameIdParamsSchema,
        },
      },
      async (request, reply) => {
        const userId = request.user.id;
        const gameId = request.params.id;

        const [gamePlayer] = await db
          .select({ id: gamePlayers.id, cashBalance: gamePlayers.cashBalance })
          .from(gamePlayers)
          .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.userId, userId)))
          .limit(1);
        if (!gamePlayer) return reply.status(404).send({ error: 'You are not a member of this game' });

        const portfolio = await loadPlayerPortfolio(
          db,
          provider,
          gamePlayer.id,
          Number(gamePlayer.cashBalance),
        );
        return reply.status(200).send(portfolio);
      },
    );
  };
}
