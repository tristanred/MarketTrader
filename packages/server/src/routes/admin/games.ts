import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, count, desc, eq, inArray, like, or, sql } from 'drizzle-orm';
import type { Db } from '../../db/index.js';
import { schema } from '../../db/index.js';
import { recordAdminAction } from '../../services/admin-audit.js';
import { recomputeGameStatus } from '../../services/game-status.js';
import { cancelWorkingOrder, WorkingOrderNotFoundError } from '../../services/working-order.js';

const idParams = z.object({ id: z.string() });
const playerParams = z.object({ id: z.string(), playerId: z.string() });

const listQuery = z.object({
  q: z.string().optional(),
  status: z.enum(['pending', 'active', 'ended']).optional(),
  ownerId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

const updateBody = z.object({
  name: z.string().min(1).max(100).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  startingBalance: z.number().positive().optional(),
  allowShortSelling: z.boolean().optional(),
  allowLimitOrders: z.boolean().optional(),
  allowStopOrders: z.boolean().optional(),
  allowBracketOrders: z.boolean().optional(),
  allowGTC: z.boolean().optional(),
});

const transferOwnerBody = z.object({ newOwnerId: z.string() });
const statusBody = z.object({ status: z.enum(['pending', 'active', 'ended']) });
const addPlayerBody = z.object({ userId: z.string() });
const deleteQuery = z.object({ force: z.coerce.boolean().optional().default(false) });

/**
 * Registers admin game-management routes (all require requireAdmin):
 *   GET    /admin/games
 *   GET    /admin/games/:id
 *   PATCH  /admin/games/:id                — edit settings
 *   PATCH  /admin/games/:id/owner          — transfer ownership (auto-enrol new owner)
 *   POST   /admin/games/:id/status         — force-override status
 *   POST   /admin/games/:id/reset          — wipe trades + restore cash
 *   DELETE /admin/games/:id                — cascade-delete
 *   POST   /admin/games/:id/players        — enrol a user
 *   DELETE /admin/games/:id/players/:playerId — remove a player
 *   POST   /admin/games/:id/cancel-working-orders
 */
export function adminGamesRoutes(db: Db) {
  return async function (rawApp: FastifyInstance): Promise<void> {
    const app = rawApp.withTypeProvider<ZodTypeProvider>();
    const { games, gamePlayers, trades, portfolios, users } = schema;

    app.get('/admin/games', {
      onRequest: rawApp.requireAdmin,
      schema: { tags: ['Admin'], summary: 'List games (paginated).', security: [{ bearerAuth: [] }], querystring: listQuery },
    }, async (request, reply) => {
      const { q, status, ownerId, limit, offset } = request.query;
      const conds = [
        q ? like(games.name, `%${q}%`) : undefined,
        status ? eq(games.status, status) : undefined,
        ownerId ? eq(games.createdBy, ownerId) : undefined,
      ].filter((c) => c !== undefined);
      const where = conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);

      const rows = await db
        .select({
          id: games.id,
          name: games.name,
          status: games.status,
          startDate: games.startDate,
          endDate: games.endDate,
          startingBalance: games.startingBalance,
          createdBy: games.createdBy,
          createdAt: games.createdAt,
        })
        .from(games)
        .where(where)
        .orderBy(desc(games.createdAt))
        .limit(limit)
        .offset(offset);

      const playerCounts = rows.length === 0 ? [] : await db
        .select({ gameId: gamePlayers.gameId, c: count() })
        .from(gamePlayers)
        .where(inArray(gamePlayers.gameId, rows.map((r) => r.id)))
        .groupBy(gamePlayers.gameId);
      const countByGame = new Map(playerCounts.map((p) => [p.gameId, Number(p.c)]));

      const totalRow = await db.select({ c: count() }).from(games).where(where);

      return reply.status(200).send({
        games: rows.map((r) => ({
          ...r,
          startingBalance: Number(r.startingBalance),
          playerCount: countByGame.get(r.id) ?? 0,
        })),
        total: Number(totalRow[0]?.c ?? 0),
      });
    });

    app.get('/admin/games/:id', {
      onRequest: rawApp.requireAdmin,
      schema: { tags: ['Admin'], summary: 'Get a single game.', security: [{ bearerAuth: [] }], params: idParams },
    }, async (request, reply) => {
      const { id } = request.params;
      const [game] = await db.select().from(games).where(eq(games.id, id)).limit(1);
      if (!game) return reply.status(404).send({ error: 'Game not found' });
      const playersRow = await db.select({ c: count() }).from(gamePlayers).where(eq(gamePlayers.gameId, id));
      const status = await recomputeGameStatus(db, game);
      return reply.status(200).send({
        ...game,
        status,
        startingBalance: Number(game.startingBalance),
        playerCount: Number(playersRow[0]?.c ?? 0),
      });
    });

    app.patch('/admin/games/:id', {
      onRequest: rawApp.requireAdmin,
      schema: { tags: ['Admin'], summary: 'Edit game settings.', security: [{ bearerAuth: [] }], params: idParams, body: updateBody },
    }, async (request, reply) => {
      const { id } = request.params;
      const patch = request.body;
      const adminId = request.user.id;

      if (Object.keys(patch).length === 0) return reply.status(400).send({ error: 'No fields provided' });
      if (patch.startDate && patch.endDate && patch.endDate <= patch.startDate) {
        return reply.status(400).send({ error: 'endDate must be after startDate' });
      }

      const [existing] = await db.select().from(games).where(eq(games.id, id)).limit(1);
      if (!existing) return reply.status(404).send({ error: 'Game not found' });

      await db.transaction(async (tx) => {
        await tx.update(games).set(patch).where(eq(games.id, id));
        await recordAdminAction(tx, {
          adminUserId: adminId,
          action: 'game.update',
          targetType: 'game',
          targetId: id,
          before: existing,
          after: { ...existing, ...patch },
        });
      });

      // Recompute may move status pending→active or active→ended after date change.
      const [refreshed] = await db.select().from(games).where(eq(games.id, id)).limit(1);
      if (refreshed) await recomputeGameStatus(db, refreshed);

      return reply.status(204).send();
    });

    app.patch('/admin/games/:id/owner', {
      onRequest: rawApp.requireAdmin,
      schema: { tags: ['Admin'], summary: 'Transfer game ownership; auto-enrols new owner if missing.', security: [{ bearerAuth: [] }], params: idParams, body: transferOwnerBody },
    }, async (request, reply) => {
      const { id } = request.params;
      const { newOwnerId } = request.body;
      const adminId = request.user.id;

      const [game] = await db.select().from(games).where(eq(games.id, id)).limit(1);
      if (!game) return reply.status(404).send({ error: 'Game not found' });

      const [newOwner] = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.id, newOwnerId))
        .limit(1);
      if (!newOwner) return reply.status(404).send({ error: 'newOwnerId user not found' });

      await db.transaction(async (tx) => {
        const [enrolled] = await tx
          .select({ id: gamePlayers.id })
          .from(gamePlayers)
          .where(and(eq(gamePlayers.gameId, id), eq(gamePlayers.userId, newOwnerId)))
          .limit(1);
        if (!enrolled) {
          await tx.insert(gamePlayers).values({
            gameId: id,
            userId: newOwnerId,
            cashBalance: Number(game.startingBalance),
          });
        }
        await tx.update(games).set({ createdBy: newOwnerId }).where(eq(games.id, id));
        await recordAdminAction(tx, {
          adminUserId: adminId,
          action: 'game.transfer_owner',
          targetType: 'game',
          targetId: id,
          before: { createdBy: game.createdBy },
          after: { createdBy: newOwnerId },
          metadata: { autoEnrolled: !enrolled },
        });
      });

      return reply.status(204).send();
    });

    app.post('/admin/games/:id/status', {
      onRequest: rawApp.requireAdmin,
      schema: { tags: ['Admin'], summary: 'Force-override game status.', security: [{ bearerAuth: [] }], params: idParams, body: statusBody },
    }, async (request, reply) => {
      const { id } = request.params;
      const { status } = request.body;
      const adminId = request.user.id;

      const [existing] = await db.select().from(games).where(eq(games.id, id)).limit(1);
      if (!existing) return reply.status(404).send({ error: 'Game not found' });

      await db.transaction(async (tx) => {
        await tx.update(games).set({ status }).where(eq(games.id, id));
        await recordAdminAction(tx, {
          adminUserId: adminId,
          action: 'game.set_status',
          targetType: 'game',
          targetId: id,
          before: { status: existing.status },
          after: { status },
        });
      });

      return reply.status(204).send();
    });

    app.post('/admin/games/:id/reset', {
      onRequest: rawApp.requireAdmin,
      schema: { tags: ['Admin'], summary: 'Wipe trades + portfolios, restore cash to startingBalance.', security: [{ bearerAuth: [] }], params: idParams, querystring: deleteQuery },
    }, async (request, reply) => {
      const { id } = request.params;
      const { force } = request.query;
      const adminId = request.user.id;

      const [game] = await db.select().from(games).where(eq(games.id, id)).limit(1);
      if (!game) return reply.status(404).send({ error: 'Game not found' });

      const tradesRow = await db
        .select({ c: count() })
        .from(trades)
        .innerJoin(gamePlayers, eq(trades.gamePlayerId, gamePlayers.id))
        .where(eq(gamePlayers.gameId, id));
      const tradeCount = Number(tradesRow[0]?.c ?? 0);

      if (!force && tradeCount > 0) {
        return reply.status(409).send({
          error: 'has_dependents',
          message: 'Game has trades; pass ?force=true to wipe.',
          dependents: { executedTrades: tradeCount },
        });
      }

      await db.transaction(async (tx) => {
        const playerRows = await tx.select({ id: gamePlayers.id }).from(gamePlayers).where(eq(gamePlayers.gameId, id));
        const playerIds = playerRows.map((p) => p.id);
        if (playerIds.length > 0) {
          await tx.delete(trades).where(inArray(trades.gamePlayerId, playerIds));
          await tx.delete(portfolios).where(inArray(portfolios.gamePlayerId, playerIds));
          await tx
            .update(gamePlayers)
            .set({ cashBalance: Number(game.startingBalance) })
            .where(eq(gamePlayers.gameId, id));
        }
        await recordAdminAction(tx, {
          adminUserId: adminId,
          action: 'game.reset',
          targetType: 'game',
          targetId: id,
          metadata: { wipedTrades: tradeCount, playerCount: playerIds.length, force },
        });
      });

      return reply.status(204).send();
    });

    app.delete('/admin/games/:id', {
      onRequest: rawApp.requireAdmin,
      schema: { tags: ['Admin'], summary: 'Delete a game; cascades to players/trades/portfolios.', security: [{ bearerAuth: [] }], params: idParams, querystring: deleteQuery },
    }, async (request, reply) => {
      const { id } = request.params;
      const { force } = request.query;
      const adminId = request.user.id;

      const [existing] = await db.select().from(games).where(eq(games.id, id)).limit(1);
      if (!existing) return reply.status(404).send({ error: 'Game not found' });

      const playersRow = await db.select({ c: count() }).from(gamePlayers).where(eq(gamePlayers.gameId, id));
      const players = Number(playersRow[0]?.c ?? 0);
      if (!force && players > 0) {
        return reply.status(409).send({
          error: 'has_dependents',
          message: 'Game has players; pass ?force=true to cascade.',
          dependents: { players },
        });
      }

      await db.transaction(async (tx) => {
        await tx.delete(games).where(eq(games.id, id));
        await recordAdminAction(tx, {
          adminUserId: adminId,
          action: 'game.delete',
          targetType: 'game',
          targetId: id,
          before: existing,
          metadata: { players, force },
        });
      });

      return reply.status(204).send();
    });

    app.post('/admin/games/:id/players', {
      onRequest: rawApp.requireAdmin,
      schema: { tags: ['Admin'], summary: 'Enrol a user as a player.', security: [{ bearerAuth: [] }], params: idParams, body: addPlayerBody },
    }, async (request, reply) => {
      const { id } = request.params;
      const { userId } = request.body;
      const adminId = request.user.id;

      const [game] = await db.select().from(games).where(eq(games.id, id)).limit(1);
      if (!game) return reply.status(404).send({ error: 'Game not found' });
      const [user] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
      if (!user) return reply.status(404).send({ error: 'User not found' });

      const [existing] = await db
        .select({ id: gamePlayers.id })
        .from(gamePlayers)
        .where(and(eq(gamePlayers.gameId, id), eq(gamePlayers.userId, userId)))
        .limit(1);
      if (existing) return reply.status(409).send({ error: 'User already enrolled' });

      const inserted = await db.transaction(async (tx) => {
        const rows = await tx
          .insert(gamePlayers)
          .values({ gameId: id, userId, cashBalance: Number(game.startingBalance) })
          .returning({ id: gamePlayers.id });
        await recordAdminAction(tx, {
          adminUserId: adminId,
          action: 'game.add_player',
          targetType: 'game',
          targetId: id,
          metadata: { userId },
        });
        return rows[0];
      });

      return reply.status(201).send({ playerId: inserted?.id });
    });

    app.delete('/admin/games/:id/players/:playerId', {
      onRequest: rawApp.requireAdmin,
      schema: { tags: ['Admin'], summary: 'Remove a player; cascades to their trades/holdings.', security: [{ bearerAuth: [] }], params: playerParams },
    }, async (request, reply) => {
      const { id, playerId } = request.params;
      const adminId = request.user.id;

      const [existing] = await db
        .select()
        .from(gamePlayers)
        .where(and(eq(gamePlayers.id, playerId), eq(gamePlayers.gameId, id)))
        .limit(1);
      if (!existing) return reply.status(404).send({ error: 'Player not found in this game' });

      await db.transaction(async (tx) => {
        await tx.delete(gamePlayers).where(eq(gamePlayers.id, playerId));
        await recordAdminAction(tx, {
          adminUserId: adminId,
          action: 'game.remove_player',
          targetType: 'game',
          targetId: id,
          metadata: { playerId, userId: existing.userId },
        });
      });

      return reply.status(204).send();
    });

    app.get('/admin/games/:id/players', {
      onRequest: rawApp.requireAdmin,
      schema: {
        tags: ['Admin'],
        summary: 'List players in a game (admin-only, bypasses membership check).',
        security: [{ bearerAuth: [] }],
        params: idParams,
      },
    }, async (request, reply) => {
      const { id } = request.params;
      const rows = await db
        .select({
          playerId: gamePlayers.id,
          userId: gamePlayers.userId,
          username: schema.users.username,
          cashBalance: gamePlayers.cashBalance,
          joinedAt: gamePlayers.joinedAt,
        })
        .from(gamePlayers)
        .innerJoin(schema.users, eq(schema.users.id, gamePlayers.userId))
        .where(eq(gamePlayers.gameId, id))
        .orderBy(gamePlayers.joinedAt);
      return reply.status(200).send({ players: rows });
    });

    const tradesListQuery = z.object({
      status: z.enum(['pending', 'working', 'executed', 'cancelled']).optional(),
      playerId: z.string().optional(),
      symbol: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(500).optional().default(100),
      offset: z.coerce.number().int().min(0).optional().default(0),
    });

    app.get('/admin/games/:id/trades', {
      onRequest: rawApp.requireAdmin,
      schema: {
        tags: ['Admin'],
        summary: 'List trades in a game with optional filters (admin-only — all players).',
        security: [{ bearerAuth: [] }],
        params: idParams,
        querystring: tradesListQuery,
      },
    }, async (request, reply) => {
      const { id } = request.params;
      const { status, playerId, symbol, limit, offset } = request.query;

      const conditions = [eq(gamePlayers.gameId, id)];
      if (status) conditions.push(eq(trades.status, status));
      if (playerId) conditions.push(eq(trades.gamePlayerId, playerId));
      if (symbol) conditions.push(eq(trades.symbol, symbol.toUpperCase()));

      const rows = await db
        .select({
          id: trades.id,
          gamePlayerId: trades.gamePlayerId,
          userId: gamePlayers.userId,
          username: users.username,
          symbol: trades.symbol,
          direction: trades.direction,
          quantity: trades.quantity,
          status: trades.status,
          orderType: trades.orderType,
          price: trades.price,
          placedAt: trades.placedAt,
        })
        .from(trades)
        .innerJoin(gamePlayers, eq(trades.gamePlayerId, gamePlayers.id))
        .innerJoin(users, eq(users.id, gamePlayers.userId))
        .where(and(...conditions))
        .orderBy(desc(trades.placedAt))
        .limit(limit)
        .offset(offset);

      const [totalRow] = await db
        .select({ c: count() })
        .from(trades)
        .innerJoin(gamePlayers, eq(trades.gamePlayerId, gamePlayers.id))
        .where(and(...conditions));

      return reply.status(200).send({
        trades: rows,
        total: Number(totalRow?.c ?? 0),
      });
    });

    app.post('/admin/games/:id/cancel-working-orders', {
      onRequest: rawApp.requireAdmin,
      schema: { tags: ['Admin'], summary: 'Bulk-cancel every working/pending order in this game.', security: [{ bearerAuth: [] }], params: idParams },
    }, async (request, reply) => {
      const { id } = request.params;
      const adminId = request.user.id;

      const open = await db
        .select({ id: trades.id, gamePlayerId: trades.gamePlayerId, status: trades.status })
        .from(trades)
        .innerJoin(gamePlayers, eq(trades.gamePlayerId, gamePlayers.id))
        .where(
          and(
            eq(gamePlayers.gameId, id),
            or(eq(trades.status, 'working'), eq(trades.status, 'pending')),
          ),
        );

      let cancelled = 0;
      for (const row of open) {
        if (row.status === 'working') {
          try {
            await cancelWorkingOrder(db, row.gamePlayerId, row.id, 'admin_bulk_cancel');
            cancelled++;
          } catch (err) {
            if (!(err instanceof WorkingOrderNotFoundError)) throw err;
          }
        } else {
          // Pending market-hours orders: flip status + release reservation inline.
          await db.transaction(async (tx) => {
            const [r] = await tx
              .select()
              .from(trades)
              .where(and(eq(trades.id, row.id), eq(trades.status, 'pending')))
              .limit(1);
            if (!r) return;
            // Refund any reservedCash that was locked at order placement (buy side).
            if (r.direction === 'buy' && r.reservedCash != null) {
              await tx
                .update(gamePlayers)
                .set({ cashBalance: sql`${gamePlayers.cashBalance} + ${r.reservedCash}` })
                .where(eq(gamePlayers.id, r.gamePlayerId));
            }
            await tx
              .update(trades)
              .set({ status: 'cancelled', cancelledAt: new Date().toISOString(), cancelReason: 'admin_bulk_cancel' })
              .where(and(eq(trades.id, row.id), eq(trades.status, 'pending')));
            cancelled++;
          });
        }
      }

      await db.transaction(async (tx) => {
        await recordAdminAction(tx, {
          adminUserId: adminId,
          action: 'game.cancel_working_orders',
          targetType: 'game',
          targetId: id,
          metadata: { cancelled, considered: open.length },
        });
      });

      return reply.status(200).send({ cancelled });
    });
  };
}
