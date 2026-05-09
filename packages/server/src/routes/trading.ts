import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import type { StockProvider } from '../providers/index.js';
import { StockProviderError, TradeError } from '../providers/index.js';
import { recomputeGameStatus } from '../services/game-status.js';
import { executeTrade, computeUnrealizedPnL } from '../services/trade.js';
import type { TradeDirection } from '@markettrader/shared';

const placeTradeSchema = z.object({
  symbol: z.string().min(1).max(10).transform((s) => s.toUpperCase()),
  direction: z.enum(['buy', 'sell']),
  quantity: z.number().int().min(1),
});

export function tradingRoutes(db: Db, provider: StockProvider) {
  return async function (app: FastifyInstance): Promise<void> {
    const { games, gamePlayers, portfolios, trades } = schema;

    app.post<{ Params: { id: string } }>(
      '/games/:id/trades',
      { preHandler: app.authenticate },
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

        let quote;
        try {
          quote = await provider.getQuote(symbol);
        } catch (err) {
          if (err instanceof StockProviderError) {
            if (err.code === 'SYMBOL_NOT_FOUND') return reply.status(404).send({ error: err.message });
            if (err.code === 'RATE_LIMITED') return reply.status(429).send({ error: err.message });
            return reply.status(502).send({ error: err.message });
          }
          throw err;
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

        return reply.status(201).send({
          trade,
          cashBalance: Number(updatedPlayer?.cashBalance ?? 0),
        });
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
          .where(eq(trades.gamePlayerId, gamePlayer.id))
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

        const totalValue =
          cashBalance + enrichedHoldings.reduce((sum, h) => sum + h.marketValue, 0);

        return reply.status(200).send({ cashBalance, holdings: enrichedHoldings, totalValue });
      },
    );
  };
}
