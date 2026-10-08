import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, eq } from 'drizzle-orm';
import type { DiscoverResponse } from '@markettrader/shared';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import { getDiscoverForGame } from '../services/discover.js';

const gameIdParamsSchema = z.object({ id: z.string() });

/**
 * `GET /games/:id/discover` — the game's newest Discover list. Reads only
 * stored rows produced by the Discover worker, so it never waits on the stock
 * provider. 404s for non-members, like the other game-scoped routes.
 */
export function discoverRoutes(db: Db) {
  return async (rawApp: FastifyInstance) => {
    const app = rawApp.withTypeProvider<ZodTypeProvider>();

    app.get(
      '/games/:id/discover',
      {
        onRequest: rawApp.authenticate,
        schema: {
          tags: ['Discover'],
          summary: "Today's Discover list for a game (membership required).",
          security: [{ bearerAuth: [] }],
          params: gameIdParamsSchema,
        },
      },
      async (request, reply) => {
        const { id: gameId } = request.params;

        const [game] = await db
          .select({ status: schema.games.status, endDate: schema.games.endDate })
          .from(schema.games)
          .where(eq(schema.games.id, gameId))
          .limit(1);
        if (!game) return reply.status(404).send({ error: 'Game not found' });

        // 404 rather than 403 so game IDs aren't enumerable by non-members.
        const [membership] = await db
          .select({ id: schema.gamePlayers.id })
          .from(schema.gamePlayers)
          .where(
            and(
              eq(schema.gamePlayers.gameId, gameId),
              eq(schema.gamePlayers.userId, request.user.id),
            ),
          )
          .limit(1);
        if (!membership) return reply.status(404).send({ error: 'Game not found' });

        // Judged from the end date too: the stored status lags until something
        // recomputes it, and recomputing here would run the game-end side effects.
        if (game.status === 'ended' || new Date().toISOString() >= game.endDate) {
          return reply.send({ status: 'ended' } satisfies DiscoverResponse);
        }

        const list = await getDiscoverForGame(db, gameId);
        const body: DiscoverResponse = list ? { status: 'ready', list } : { status: 'preparing' };
        return reply.send(body);
      },
    );
  };
}
