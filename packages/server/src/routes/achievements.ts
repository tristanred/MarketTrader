import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import type { AchievementEngine } from '../achievements/engine.js';
import {
  getAchievementsForGame,
  getProgressForPlayer,
} from '../services/achievement.js';

const gameIdParams = z.object({ id: z.string() });
const gameAndPlayerParams = z.object({ id: z.string(), gamePlayerId: z.string() });

/**
 * Registers the player-facing achievement routes (all require authentication
 * and game membership):
 *  - `GET /games/:id/achievements` — definitions + progress for every player
 *  - `GET /games/:id/players/:gamePlayerId/achievements` — one player's view
 *  - `POST /games/:id/players/:gamePlayerId/achievements/ack` — advance `last_seen_unlock_at`
 */
export function achievementsRoutes(db: Db, engine: AchievementEngine) {
  return async function (rawApp: FastifyInstance): Promise<void> {
    const app = rawApp.withTypeProvider<ZodTypeProvider>();
    const { games, gamePlayers } = schema;

    app.get(
      '/games/:id/achievements',
      {
        onRequest: rawApp.authenticate,
        schema: {
          tags: ['Achievements'],
          summary: 'List achievement definitions + progress for every player in the game.',
          security: [{ bearerAuth: [] }],
          params: gameIdParams,
        },
      },
      async (request, reply) => {
        const gameId = request.params.id;
        const userId = request.user.id;

        const [game] = await db.select({ id: games.id }).from(games).where(eq(games.id, gameId)).limit(1);
        if (!game) return reply.status(404).send({ error: 'Game not found' });

        const [membership] = await db
          .select({ id: gamePlayers.id })
          .from(gamePlayers)
          .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.userId, userId)))
          .limit(1);
        if (!membership) return reply.status(404).send({ error: 'Game not found' });

        const view = await getAchievementsForGame(db, engine, gameId);
        return reply.status(200).send(view);
      },
    );

    app.get(
      '/games/:id/players/:gamePlayerId/achievements',
      {
        onRequest: rawApp.authenticate,
        schema: {
          tags: ['Achievements'],
          summary: 'Achievement progress for a single player in a game.',
          security: [{ bearerAuth: [] }],
          params: gameAndPlayerParams,
        },
      },
      async (request, reply) => {
        const { id: gameId, gamePlayerId } = request.params;
        const userId = request.user.id;

        const [game] = await db.select({ id: games.id }).from(games).where(eq(games.id, gameId)).limit(1);
        if (!game) return reply.status(404).send({ error: 'Game not found' });

        const [membership] = await db
          .select({ id: gamePlayers.id })
          .from(gamePlayers)
          .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.userId, userId)))
          .limit(1);
        if (!membership) return reply.status(404).send({ error: 'Game not found' });

        const [target] = await db
          .select({ id: gamePlayers.id })
          .from(gamePlayers)
          .where(and(eq(gamePlayers.id, gamePlayerId), eq(gamePlayers.gameId, gameId)))
          .limit(1);
        if (!target) return reply.status(404).send({ error: 'Player not in this game' });

        const view = await getProgressForPlayer(db, engine, gameId, gamePlayerId);
        return reply.status(200).send(view);
      },
    );

    app.post(
      '/games/:id/players/:gamePlayerId/achievements/ack',
      {
        onRequest: rawApp.authenticate,
        schema: {
          tags: ['Achievements'],
          summary: 'Acknowledge an achievement unlock; advances last_seen_unlock_at.',
          security: [{ bearerAuth: [] }],
          params: gameAndPlayerParams,
          body: z.object({ unlockedAt: z.string().datetime() }),
        },
      },
      async (request, reply) => {
        const { id: gameId, gamePlayerId } = request.params;
        const { unlockedAt } = request.body;
        const userId = request.user.id;

        const [player] = await db
          .select({ userId: gamePlayers.userId, gameId: gamePlayers.gameId })
          .from(gamePlayers)
          .where(eq(gamePlayers.id, gamePlayerId))
          .limit(1);
        if (!player || player.gameId !== gameId) {
          return reply.status(404).send({ error: 'Player not in this game' });
        }
        if (player.userId !== userId) {
          return reply.status(403).send({ error: 'Forbidden' });
        }

        await db
          .update(gamePlayers)
          .set({
            lastSeenUnlockAt: sql`
              CASE
                WHEN ${gamePlayers.lastSeenUnlockAt} IS NULL THEN ${unlockedAt}
                WHEN ${gamePlayers.lastSeenUnlockAt} < ${unlockedAt} THEN ${unlockedAt}
                ELSE ${gamePlayers.lastSeenUnlockAt}
              END
            `,
          })
          .where(eq(gamePlayers.id, gamePlayerId));

        return reply.status(204).send();
      },
    );
  };
}
