import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { eq, and, count } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import { isUniqueConstraintError } from '../db/errors.js';
import { recomputeGameStatus, recomputeMany } from '../services/game-status.js';
import { generateInviteCode } from '../services/invite-code.js';
import { computeLeaderboard } from '../services/leaderboard.js';
import { getLeaderboardHistory } from '../services/leaderboard-history.js';
import type { EventBus } from '../events/bus.js';

const gameIdParamsSchema = z.object({ id: z.string() });

const updateGameSchema = z.object({
  visibility: z.enum(['public', 'private']),
});

const inviteCodeParamsSchema = z.object({ code: z.string().min(1).max(32) });

const leaderboardHistoryQuerySchema = z.object({
  range: z.enum(['1d', '5d', '10d', 'all']).optional().default('5d'),
  maxPoints: z.coerce.number().int().min(10).max(1000).optional().default(240),
});

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
    achievementsEnabled: z.boolean().optional().default(true),
    visibility: z.enum(['public', 'private']).optional().default('public'),
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
export function gameRoutes(db: Db, bus?: EventBus) {
  return async function (rawApp: FastifyInstance): Promise<void> {
    const app = rawApp.withTypeProvider<ZodTypeProvider>();
    const { games, gamePlayers, users } = schema;

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
          achievementsEnabled: games.achievementsEnabled,
          visibility: games.visibility,
          inviteCode: games.inviteCode,
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
      const {
        name,
        startDate,
        endDate,
        startingBalance,
        allowShortSelling,
        allowLimitOrders,
        allowStopOrders,
        allowBracketOrders,
        allowGTC,
        achievementsEnabled,
        visibility,
      } = request.body;
      const userId = request.user.id;

      // The unique index on invite_code makes a collision a hard failure
      // rather than silent data corruption, so retry on the astronomically
      // unlikely duplicate instead of surfacing a 500.
      let game: typeof games.$inferSelect | undefined;
      for (let attempt = 0; attempt < 5 && !game; attempt++) {
        try {
          [game] = await db
            .insert(games)
            .values({
              name,
              startDate,
              endDate,
              startingBalance,
              allowShortSelling,
              allowLimitOrders,
              allowStopOrders,
              allowBracketOrders,
              allowGTC,
              achievementsEnabled,
              visibility,
              inviteCode: generateInviteCode(),
              createdBy: userId,
            })
            .returning();
        } catch (err: unknown) {
          if (!isUniqueConstraintError(err)) throw err;
        }
      }

      if (!game) return reply.status(500).send({ error: 'Failed to create game' });

      const [creatorPlayer] = await db
        .insert(gamePlayers)
        .values({ gameId: game.id, userId, cashBalance: startingBalance })
        .returning();

      const status = await recomputeGameStatus(db, game, new Date().toISOString(), bus);

      if (bus && creatorPlayer) {
        void bus.emit({
          type: 'player.joined',
          gameId: game.id,
          gamePlayerId: creatorPlayer.id,
          userId,
          joinedAt: creatorPlayer.joinedAt,
        });
      }

      return reply.status(201).send({ ...game, startingBalance: Number(game.startingBalance), status });
    });

    app.get('/games/browse', {
      onRequest: rawApp.authenticate,
      schema: {
        tags: ['Games'],
        summary: 'List public games the caller has not joined and can still join.',
        security: [{ bearerAuth: [] }],
      },
    }, async (request, reply) => {
      const userId = request.user.id;

      const joined = await db
        .select({ gameId: gamePlayers.gameId })
        .from(gamePlayers)
        .where(eq(gamePlayers.userId, userId));
      const joinedIds = new Set(joined.map(r => r.gameId));

      const rows = await db
        .select({
          id: games.id,
          name: games.name,
          startDate: games.startDate,
          endDate: games.endDate,
          startingBalance: games.startingBalance,
          status: games.status,
          createdAt: games.createdAt,
          createdByUsername: users.username,
        })
        .from(games)
        .innerJoin(users, eq(games.createdBy, users.id))
        .where(eq(games.visibility, 'public'));

      const candidates = rows.filter(g => !joinedIds.has(g.id));

      // Recompute so a game that has just passed its endDate is filtered out
      // here rather than being offered and then rejected with 409 on join.
      const statusMap = await recomputeMany(db, candidates);

      const counts = await db
        .select({ gameId: gamePlayers.gameId, players: count() })
        .from(gamePlayers)
        .groupBy(gamePlayers.gameId);
      const countMap = new Map(counts.map(c => [c.gameId, Number(c.players)]));

      const open = candidates
        .filter(g => (statusMap.get(g.id) ?? g.status) !== 'ended')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(g => ({
          ...g,
          startingBalance: Number(g.startingBalance),
          status: statusMap.get(g.id) ?? g.status,
          playerCount: countMap.get(g.id) ?? 0,
        }));

      return reply.status(200).send(open);
    });

    app.get('/games/by-code/:code', {
      onRequest: rawApp.authenticate,
      schema: {
        tags: ['Games'],
        summary: 'Resolve an invite code to a join prompt.',
        security: [{ bearerAuth: [] }],
        params: inviteCodeParamsSchema,
      },
    }, async (request, reply) => {
      // Codes are generated uppercase; normalising here lets a link survive
      // being lowercased by a chat client or typed by hand.
      const code = request.params.code.toUpperCase();
      const userId = request.user.id;

      const [row] = await db
        .select({
          id: games.id,
          name: games.name,
          startDate: games.startDate,
          endDate: games.endDate,
          startingBalance: games.startingBalance,
          status: games.status,
          createdByUsername: users.username,
        })
        .from(games)
        .innerJoin(users, eq(games.createdBy, users.id))
        .where(eq(games.inviteCode, code))
        .limit(1);

      if (!row) return reply.status(404).send({ error: 'Invite code not found' });

      // Recompute for the same reason browse does: the join prompt must not
      // offer a game whose endDate has passed only to have join answer 409.
      const status = await recomputeGameStatus(db, row, new Date().toISOString(), bus);

      const [{ players } = { players: 0 }] = await db
        .select({ players: count() })
        .from(gamePlayers)
        .where(eq(gamePlayers.gameId, row.id));

      const [membership] = await db
        .select({ id: gamePlayers.id })
        .from(gamePlayers)
        .where(and(eq(gamePlayers.gameId, row.id), eq(gamePlayers.userId, userId)))
        .limit(1);

      return reply.status(200).send({
        ...row,
        status,
        startingBalance: Number(row.startingBalance),
        playerCount: Number(players),
        alreadyMember: Boolean(membership),
      });
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

      const status = await recomputeGameStatus(db, game, new Date().toISOString(), bus);
      if (status === 'ended') return reply.status(409).send({ error: 'Game has ended' });

      let player: typeof gamePlayers.$inferSelect | undefined;
      try {
        const [inserted] = await db
          .insert(gamePlayers)
          .values({ gameId, userId, cashBalance: game.startingBalance })
          .returning();
        player = inserted;
      } catch (err: unknown) {
        if (isUniqueConstraintError(err)) {
          return reply.status(409).send({ error: 'Already joined this game' });
        }
        throw err;
      }

      if (!player) return reply.status(500).send({ error: 'Failed to join game' });

      if (bus) {
        void bus.emit({
          type: 'player.joined',
          gameId: player.gameId,
          gamePlayerId: player.id,
          userId,
          joinedAt: player.joinedAt,
        });
      }

      return reply.status(201).send({
        playerId: player.id,
        gameId: player.gameId,
        cashBalance: Number(player.cashBalance),
        joinedAt: player.joinedAt,
      });
    });

    app.post('/games/:id/invite-code', {
      onRequest: rawApp.authenticate,
      schema: {
        tags: ['Games'],
        summary: "Return this game's invite code, minting one if it has none.",
        security: [{ bearerAuth: [] }],
        params: gameIdParamsSchema,
      },
    }, async (request, reply) => {
      const { id: gameId } = request.params;
      const userId = request.user.id;

      const [game] = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
      if (!game) return reply.status(404).send({ error: 'Game not found' });

      // 404 rather than 403 for non-members, matching GET /games/:id so game
      // IDs stay non-enumerable.
      const [membership] = await db
        .select({ id: gamePlayers.id })
        .from(gamePlayers)
        .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.userId, userId)))
        .limit(1);
      if (!membership) return reply.status(404).send({ error: 'Game not found' });

      if (game.inviteCode) return reply.status(200).send({ inviteCode: game.inviteCode });

      // Games created before invite codes existed have none; mint on demand.
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = generateInviteCode();
        try {
          const [updated] = await db
            .update(games)
            .set({ inviteCode: candidate })
            .where(eq(games.id, gameId))
            .returning();
          if (updated?.inviteCode) {
            return reply.status(200).send({ inviteCode: updated.inviteCode });
          }
        } catch (err: unknown) {
          if (!isUniqueConstraintError(err)) throw err;
        }
      }

      return reply.status(500).send({ error: 'Failed to mint invite code' });
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

      const status = await recomputeGameStatus(db, game, new Date().toISOString(), bus);
      const leaderboard = await computeLeaderboard(db, gameId);

      return reply.status(200).send({
        ...game,
        startingBalance: Number(game.startingBalance),
        status,
        leaderboard,
        viewerGamePlayerId: membership.id,
      });
    });

    app.patch('/games/:id', {
      onRequest: rawApp.authenticate,
      schema: {
        tags: ['Games'],
        summary: "Update a game's visibility. Creator only.",
        security: [{ bearerAuth: [] }],
        params: gameIdParamsSchema,
        body: updateGameSchema,
      },
    }, async (request, reply) => {
      const { id: gameId } = request.params;
      const { visibility } = request.body;
      const userId = request.user.id;

      const [game] = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
      if (!game) return reply.status(404).send({ error: 'Game not found' });

      // 403 rather than 404 here: the caller already proved the game exists by
      // some other route, and hiding authorship would be misleading.
      if (game.createdBy !== userId) {
        return reply.status(403).send({ error: 'Only the game creator can change visibility' });
      }

      const [updated] = await db
        .update(games)
        .set({ visibility })
        .where(eq(games.id, gameId))
        .returning();

      if (!updated) return reply.status(500).send({ error: 'Failed to update game' });

      return reply.status(200).send({
        ...updated,
        startingBalance: Number(updated.startingBalance),
      });
    });

    app.get('/games/:id/leaderboard/history', {
      onRequest: rawApp.authenticate,
      schema: {
        tags: ['Games'],
        summary: 'Portfolio-value history per player over the requested range.',
        security: [{ bearerAuth: [] }],
        params: gameIdParamsSchema,
        querystring: leaderboardHistoryQuerySchema,
      },
    }, async (request, reply) => {
      const { id: gameId } = request.params;
      const { range, maxPoints } = request.query;
      const userId = request.user.id;

      // 404 for non-members so game IDs aren't enumerable. Matches GET /games/:id.
      const [game] = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
      if (!game) return reply.status(404).send({ error: 'Game not found' });

      const [membership] = await db
        .select({ id: gamePlayers.id })
        .from(gamePlayers)
        .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.userId, userId)))
        .limit(1);
      if (!membership) return reply.status(404).send({ error: 'Game not found' });

      const response = await getLeaderboardHistory(db, gameId, { range, maxPoints });
      return reply.status(200).send(response);
    });
  };
}
