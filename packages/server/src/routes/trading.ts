import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import type { StockProvider } from '../providers/index.js';
import { StockProviderError, TradeError } from '../providers/index.js';
import type { MarketStatusProvider } from '../providers/market-status/index.js';
import type { MarketState } from '@markettrader/shared';
import { recomputeGameStatus } from '../services/game-status.js';
import { executeTrade, computeUnrealizedPnL } from '../services/trade.js';
import {
  reservePendingTrade,
  listPendingTrades,
  cancelPendingTrade,
  PendingTradeNotFoundError,
} from '../services/pending-trade.js';
import { computeLeaderboard } from '../services/leaderboard.js';
import type { TradeDirection } from '@markettrader/shared';
import type { GameClientRegistry } from '../ws/registry.js';
import { env } from '../env.js';

/** Returns whether the configured policy treats this market state as "open" for trading. */
function isTradingOpen(state: MarketState): boolean {
  if (state === 'REGULAR') return true;
  if (!env.MARKET_HOURS_INCLUDE_EXTENDED) return false;
  return state === 'PRE' || state === 'POST';
}

const LEADERBOARD_THROTTLE_MS = 1_000;

const placeTradeSchema = z.object({
  symbol: z.string().min(1).max(10).transform((s) => s.toUpperCase()),
  direction: z.enum(['buy', 'sell']),
  quantity: z.number().int().min(1),
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
) {
  // Per-game leaderboard throttle: gameId → timestamp of last broadcast (ms)
  const lastLeaderboardBroadcast = new Map<string, number>();

  return async function (app: FastifyInstance): Promise<void> {
    const { games, gamePlayers, portfolios, trades } = schema;

    app.post<{ Params: { id: string } }>(
      '/games/:id/trades',
      {
        preHandler: app.authenticate,
        config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      },
      async (request, reply) => {
        const parsed = placeTradeSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.status(400).send({ error: parsed.error.issues });
        }
        const { symbol, direction, quantity } = parsed.data;
        const userId = request.user.id;
        const gameId = request.params.id;

        const [game] = await db
          .select()
          .from(games)
          .where(eq(games.id, gameId))
          .limit(1);
        if (!game) return reply.status(404).send({ error: 'Game not found' });

        const status = await recomputeGameStatus(db, game);
        if (status !== 'active') {
          return reply.status(409).send({ error: 'GAME_NOT_ACTIVE', message: `Game is ${status}` });
        }

        const [gamePlayer] = await db
          .select()
          .from(gamePlayers)
          .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.userId, userId)))
          .limit(1);
        if (!gamePlayer) return reply.status(404).send({ error: 'You are not a member of this game' });

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
        try {
          trade = await executeTrade(db, {
            gamePlayerId: gamePlayer.id,
            symbol,
            direction: direction as TradeDirection,
            quantity,
            price: quote.price,
          });
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
              executedAt: trade.executedAt,
            },
          });

          // Throttled: leaderboard may recompute at most once per second per game
          const now = Date.now();
          const last = lastLeaderboardBroadcast.get(gameId) ?? 0;
          if (now - last >= leaderboardThrottleMs) {
            lastLeaderboardBroadcast.set(gameId, now);
            // Fire-and-forget — do not delay the HTTP response
            computeLeaderboard(db, gameId)
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

    app.get<{ Params: { id: string } }>(
      '/games/:id/trades',
      { preHandler: app.authenticate },
      async (request, reply) => {
        const userId = request.user.id;
        const gameId = request.params.id;

        const [gamePlayer] = await db
          .select({ id: gamePlayers.id })
          .from(gamePlayers)
          .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.userId, userId)))
          .limit(1);
        if (!gamePlayer) return reply.status(404).send({ error: 'You are not a member of this game' });

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

    app.get<{ Params: { id: string } }>(
      '/games/:id/trades/pending',
      { preHandler: app.authenticate },
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

    app.delete<{ Params: { id: string; pendingId: string } }>(
      '/games/:id/trades/pending/:pendingId',
      { preHandler: app.authenticate },
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

    app.get<{ Params: { id: string } }>(
      '/games/:id/portfolio',
      { preHandler: app.authenticate },
      async (request, reply) => {
        const userId = request.user.id;
        const gameId = request.params.id;

        const [gamePlayer] = await db
          .select({ id: gamePlayers.id, cashBalance: gamePlayers.cashBalance })
          .from(gamePlayers)
          .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.userId, userId)))
          .limit(1);
        if (!gamePlayer) return reply.status(404).send({ error: 'You are not a member of this game' });

        const cashBalance = Number(gamePlayer.cashBalance);

        const holdings = await db
          .select()
          .from(portfolios)
          .where(eq(portfolios.gamePlayerId, gamePlayer.id));

        const enrichedHoldings = await Promise.all(
          holdings.map(async (h) => {
            let currentPrice = Number(h.avgCostBasis);
            try {
              const quote = await provider.getQuote(h.symbol);
              currentPrice = quote.price;
            } catch {
              // Fall back to cost basis if quote fetch fails
            }
            const avgCostBasis = Number(h.avgCostBasis);
            const marketValue = h.quantity * currentPrice;
            const unrealizedPnL = computeUnrealizedPnL(h.quantity, avgCostBasis, currentPrice);
            const unrealizedPnLPercent =
              avgCostBasis !== 0 ? ((currentPrice - avgCostBasis) / avgCostBasis) * 100 : 0;
            return {
              symbol: h.symbol,
              quantity: h.quantity,
              avgCostBasis,
              currentPrice,
              marketValue,
              unrealizedPnL,
              unrealizedPnLPercent,
            };
          }),
        );

        // Pending buys: cash already deducted, no shares yet → add reservedCash back.
        // Pending sells: shares already removed → add quantity × currentPrice back.
        const pendings = await db
          .select()
          .from(trades)
          .where(and(eq(trades.gamePlayerId, gamePlayer.id), eq(trades.status, 'pending')));

        let reservedValue = 0;
        for (const p of pendings) {
          if (p.direction === 'buy') {
            reservedValue += Number(p.reservedCash ?? 0);
          } else {
            let price = Number(p.reservedPrice ?? 0);
            try {
              const q = await provider.getQuote(p.symbol);
              price = q.price;
            } catch {
              // Fall back to reservedPrice if quote fetch fails
            }
            reservedValue += p.quantity * price;
          }
        }

        const totalValue =
          cashBalance +
          enrichedHoldings.reduce((sum, h) => sum + h.marketValue, 0) +
          reservedValue;

        return reply
          .status(200)
          .send({ cashBalance, holdings: enrichedHoldings, totalValue, reservedValue });
      },
    );
  };
}
