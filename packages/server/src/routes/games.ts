import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { eq, and } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import { recomputeGameStatus, recomputeMany } from '../services/game-status.js';
import { computeLeaderboard } from '../services/leaderboard.js';

const gameIdParamsSchema = z.object({ id: z.string() });

const createGameSchema = z
  .object({
    name: z.string().min(1).max(100),
    startDate: z.string().datetime(),
    endDate: z.string().datetime(),
    startingBalance: z.number().positive(),
    allowShortSelling: z.boolean().optional().default(false),
    allowLimitOrders: z.boolean().optional().default(false),
    allowStopOrders: z.boolean().optional().default(false),
    allowBracketOrders: z.boolean().optional().default(false),
    allowGTC: z.boolean().optional().default(false),
  })
  .refine(d => d.endDate > d.startDate, {
    message: 'endDate must be after startDate',
    path: ['endDate'],
  });

/**
 * Registers game lifecycle routes (all require authentication):
 * - `GET  /games`        — list every game the caller has joined.
 * - `POST /games`        — create a new game; creator is automatically enrolled.
 * - `POST /games/:id/join` — join an existing game (rejected if already ended).
 * - `GET  /games/:id`    — fetch game details + leaderboard (membership required).
 *
 * All routes recompute game status on the fly so `pending`/`active`/`ended`
 * reflects real time rather than the stored snapshot.
 */
export function gameRoutes(db: Db) {
  return async function (rawApp: FastifyInstance): Promise<void> {
    const app = rawApp.withTypeProvider<ZodTypeProvider>();
    const { games, gamePlayers } = schema;

    app.get('/games', {
      onRequest: rawApp.authenticate,
      schema: {
        tags: ['Games'],
        summary: 'List games the caller has joined.',
        security: [{ bearerAuth: [] }],
      },
    }, async (request, reply) => {
      const userId = request.user.id;

      const rows = await db
        .select({
          id: games.id,
          name: games.name,
          startDate: games.startDate,
          endDate: games.endDate,
          startingBalance: games.startingBalance,
          allowShortSelling: games.allowShortSelling,
          status: games.status,
          createdBy: games.createdBy,
          createdAt: games.createdAt,
        })
        .from(gamePlayers)
        .innerJoin(games, eq(gamePlayers.gameId, games.id))
        .where(eq(gamePlayers.userId, userId));

      const statusMap = await recomputeMany(db, rows);

      return reply.status(200).send(
        rows.map(g => ({
          ...g,
          startingBalance: Number(g.startingBalance),
          status: statusMap.get(g.id) ?? g.status,
        })),
      );
    });

    app.post('/games', {
      onRequest: rawApp.authenticate,
      schema: {
        tags: ['Games'],
        summary: 'Create a new game; creator is enrolled automatically.',
        security: [{ bearerAuth: [] }],
        body: createGameSchema,
      },
    }, async (request, reply) => {
      const { name, startDate, endDate, startingBalance, allowShortSelling } = request.body;
      const userId = request.user.id;

      const [game] = await db
        .insert(games)
        .values({
          name,
          startDate,
          endDate,
          startingBalance,
          allowShortSelling,
          createdBy: userId,
        })
        .returning();

      if (!game) return reply.status(500).send({ error: 'Failed to create game' });

      await db.insert(gamePlayers).values({ gameId: game.id, userId, cashBalance: startingBalance });

      const status = await recomputeGameStatus(db, game);

      return reply.status(201).send({ ...game, startingBalance: Number(game.startingBalance), status });
    });

    app.post('/games/:id/join', {
      onRequest: rawApp.authenticate,
      schema: {
        tags: ['Games'],
        summary: 'Join an existing game.',
        security: [{ bearerAuth: [] }],
        params: gameIdParamsSchema,
      },
    }, async (request, reply) => {
      const { id: gameId } = request.params;
      const userId = request.user.id;

      const [game] = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
      if (!game) return reply.status(404).send({ error: 'Game not found' });

      const status = await recomputeGameStatus(db, game);
      if (status === 'ended') return reply.status(409).send({ error: 'Game has ended' });

      let player: typeof gamePlayers.$inferSelect | undefined;
      try {
        const [inserted] = await db
          .insert(gamePlayers)
          .values({ gameId, userId, cashBalance: game.startingBalance })
          .returning();
        player = inserted;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('UNIQUE constraint failed') || msg.includes('unique constraint')) {
          return reply.status(409).send({ error: 'Already joined this game' });
        }
        throw err;
      }

      if (!player) return reply.status(500).send({ error: 'Failed to join game' });

      return reply.status(201).send({
        playerId: player.id,
        gameId: player.gameId,
        cashBalance: Number(player.cashBalance),
        joinedAt: player.joinedAt,
      });
    });

    app.get('/games/:id', {
      onRequest: rawApp.authenticate,
      schema: {
        tags: ['Games'],
        summary: 'Fetch game details + leaderboard (membership required).',
        security: [{ bearerAuth: [] }],
        params: gameIdParamsSchema,
      },
    }, async (request, reply) => {
      const { id: gameId } = request.params;
      const userId = request.user.id;

      const [game] = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
      if (!game) return reply.status(404).send({ error: 'Game not found' });

      // Return 404 (not 403) when the caller is not a member so that game IDs
      // aren't enumerable by non-participants.
      const [membership] = await db
        .select({ id: gamePlayers.id })
        .from(gamePlayers)
        .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.userId, userId)))
        .limit(1);
      if (!membership) return reply.status(404).send({ error: 'Game not found' });

      const status = await recomputeGameStatus(db, game);
      const leaderboard = await computeLeaderboard(db, gameId);

      return reply.status(200).send({
        ...game,
        startingBalance: Number(game.startingBalance),
        status,
        leaderboard,
      });
    });
  };
}
