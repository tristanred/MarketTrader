import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, asc, count, desc, eq, like, sql } from 'drizzle-orm';
import { hash } from '@node-rs/argon2';
import type { Db } from '../../db/index.js';
import { schema } from '../../db/index.js';
import { ADMIN_GROUP_NAME } from '../../constants/groups.js';
import { recordAdminAction } from '../../services/admin-audit.js';

const idParams = z.object({ id: z.string() });
const userGroupParams = z.object({ id: z.string(), groupName: z.string() });

const listQuery = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
  sort: z.enum(['createdAt', 'username']).optional().default('createdAt'),
});

const updateBody = z.object({
  username: z.string().min(3).max(30).optional(),
  disabled: z.boolean().optional(),
}).refine((b) => b.username !== undefined || b.disabled !== undefined, {
  message: 'at least one of username or disabled is required',
});

const resetPasswordBody = z.object({
  newPassword: z.string().min(8),
});

const deleteQuery = z.object({
  force: z.coerce.boolean().optional().default(false),
});

/**
 * Registers admin user-management routes. All require `requireAdmin`.
 * - GET    /admin/users            — paginated list (optional `?q=` substring).
 * - GET    /admin/users/:id        — detail with games-joined / games-owned / trade count.
 * - PATCH  /admin/users/:id        — rename or toggle `disabled`.
 * - DELETE /admin/users/:id        — cascade-delete. 409 if user owns any games, even with force.
 * - POST   /admin/users/:id/reset-password
 * - POST   /admin/users/:id/groups/:groupName    — idempotent membership add.
 * - DELETE /admin/users/:id/groups/:groupName    — remove. Self-removal blocked for `admin`.
 */
export function adminUsersRoutes(db: Db) {
  return async function (rawApp: FastifyInstance): Promise<void> {
    const app = rawApp.withTypeProvider<ZodTypeProvider>();
    const { users, userGroups, groups, games, gamePlayers, trades } = schema;

    app.get('/admin/users', {
      onRequest: rawApp.requireAdmin,
      schema: {
        tags: ['Admin'],
        summary: 'List users (paginated).',
        security: [{ bearerAuth: [] }],
        querystring: listQuery,
      },
    }, async (request, reply) => {
      const { q, limit, offset, sort } = request.query;
      const where = q ? like(users.username, `%${q}%`) : undefined;
      const orderCol = sort === 'username' ? asc(users.username) : desc(users.createdAt);

      const rows = await db
        .select({
          id: users.id,
          username: users.username,
          disabled: users.disabled,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(where)
        .orderBy(orderCol)
        .limit(limit)
        .offset(offset);

      const totalRow = await db
        .select({ total: count() })
        .from(users)
        .where(where);
      const total = totalRow[0]?.total ?? 0;

      const ids = rows.map((r) => r.id);
      const memberships = ids.length === 0
        ? []
        : await db
            .select({ userId: userGroups.userId, name: groups.name })
            .from(userGroups)
            .innerJoin(groups, eq(userGroups.groupId, groups.id))
            .where(sql`${userGroups.userId} in ${ids}`);
      const groupsByUser = new Map<string, string[]>();
      for (const m of memberships) {
        const arr = groupsByUser.get(m.userId) ?? [];
        arr.push(m.name);
        groupsByUser.set(m.userId, arr);
      }

      return reply.status(200).send({
        users: rows.map((r) => ({ ...r, groups: groupsByUser.get(r.id) ?? [] })),
        total: Number(total),
      });
    });

    app.get('/admin/users/:id', {
      onRequest: rawApp.requireAdmin,
      schema: {
        tags: ['Admin'],
        summary: 'Get a single user with aggregate counts.',
        security: [{ bearerAuth: [] }],
        params: idParams,
      },
    }, async (request, reply) => {
      const { id } = request.params;
      const [user] = await db
        .select({
          id: users.id,
          username: users.username,
          disabled: users.disabled,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      if (!user) return reply.status(404).send({ error: 'User not found' });

      const memberships = await db
        .select({ name: groups.name })
        .from(userGroups)
        .innerJoin(groups, eq(userGroups.groupId, groups.id))
        .where(eq(userGroups.userId, id));

      const gamesPlayedRow = await db
        .select({ c: count() })
        .from(gamePlayers)
        .where(eq(gamePlayers.userId, id));
      const gamesOwnedRow = await db
        .select({ c: count() })
        .from(games)
        .where(eq(games.createdBy, id));
      const tradeCountRow = await db
        .select({ c: count() })
        .from(trades)
        .innerJoin(gamePlayers, eq(trades.gamePlayerId, gamePlayers.id))
        .where(eq(gamePlayers.userId, id));

      return reply.status(200).send({
        ...user,
        groups: memberships.map((m) => m.name),
        gamesPlayed: Number(gamesPlayedRow[0]?.c ?? 0),
        gamesOwned: Number(gamesOwnedRow[0]?.c ?? 0),
        tradeCount: Number(tradeCountRow[0]?.c ?? 0),
      });
    });

    app.patch('/admin/users/:id', {
      onRequest: rawApp.requireAdmin,
      schema: {
        tags: ['Admin'],
        summary: 'Rename or toggle disabled on a user.',
        security: [{ bearerAuth: [] }],
        params: idParams,
        body: updateBody,
      },
    }, async (request, reply) => {
      const { id } = request.params;
      const patch = request.body;
      const adminId = request.user.id;

      if (patch.disabled === true && id === adminId) {
        return reply.status(409).send({ error: 'self_action_blocked', message: 'Cannot disable yourself' });
      }

      const [existing] = await db
        .select({ id: users.id, username: users.username, disabled: users.disabled })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      if (!existing) return reply.status(404).send({ error: 'User not found' });

      try {
        await db.transaction(async (tx) => {
          await tx.update(users).set(patch).where(eq(users.id, id));
          await recordAdminAction(tx, {
            adminUserId: adminId,
            action: 'user.update',
            targetType: 'user',
            targetId: id,
            before: existing,
            after: { ...existing, ...patch },
          });
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('UNIQUE constraint failed') || msg.includes('unique constraint')) {
          return reply.status(409).send({ error: 'Username already taken' });
        }
        throw err;
      }

      return reply.status(204).send();
    });

    app.delete('/admin/users/:id', {
      onRequest: rawApp.requireAdmin,
      schema: {
        tags: ['Admin'],
        summary: 'Delete a user; cascades to players/trades. Blocked if user owns any game.',
        security: [{ bearerAuth: [] }],
        params: idParams,
        querystring: deleteQuery,
      },
    }, async (request, reply) => {
      const { id } = request.params;
      const { force } = request.query;
      const adminId = request.user.id;

      if (id === adminId) {
        return reply.status(409).send({ error: 'self_action_blocked', message: 'Cannot delete yourself' });
      }

      const [existing] = await db
        .select({ id: users.id, username: users.username })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      if (!existing) return reply.status(404).send({ error: 'User not found' });

      // Always block delete if user owns games, regardless of force flag.
      const ownedRow = await db
        .select({ c: count() })
        .from(games)
        .where(eq(games.createdBy, id));
      const ownedGames = Number(ownedRow[0]?.c ?? 0);
      if (ownedGames > 0) {
        return reply.status(409).send({
          error: 'has_dependents',
          message: 'User owns games; transfer ownership before deleting.',
          dependents: { ownedGames },
        });
      }

      // Other dependents: players (with cascading trades/holdings).
      const playersRow = await db
        .select({ c: count() })
        .from(gamePlayers)
        .where(eq(gamePlayers.userId, id));
      const players = Number(playersRow[0]?.c ?? 0);

      if (!force && players > 0) {
        return reply.status(409).send({
          error: 'has_dependents',
          message: 'User has game memberships; pass ?force=true to cascade.',
          dependents: { players },
        });
      }

      await db.transaction(async (tx) => {
        await tx.delete(users).where(eq(users.id, id));
        await recordAdminAction(tx, {
          adminUserId: adminId,
          action: 'user.delete',
          targetType: 'user',
          targetId: id,
          before: existing,
          metadata: { players, force },
        });
      });

      return reply.status(204).send();
    });

    app.post('/admin/users/:id/reset-password', {
      onRequest: rawApp.requireAdmin,
      schema: {
        tags: ['Admin'],
        summary: 'Set a user\'s password to a new argon2-hashed value.',
        security: [{ bearerAuth: [] }],
        params: idParams,
        body: resetPasswordBody,
      },
    }, async (request, reply) => {
      const { id } = request.params;
      const { newPassword } = request.body;
      const adminId = request.user.id;

      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      if (!existing) return reply.status(404).send({ error: 'User not found' });

      const passwordHash = await hash(newPassword);
      await db.transaction(async (tx) => {
        await tx.update(users).set({ passwordHash }).where(eq(users.id, id));
        await recordAdminAction(tx, {
          adminUserId: adminId,
          action: 'user.reset_password',
          targetType: 'user',
          targetId: id,
        });
      });

      return reply.status(204).send();
    });

    app.post('/admin/users/:id/groups/:groupName', {
      onRequest: rawApp.requireAdmin,
      schema: {
        tags: ['Admin'],
        summary: 'Add user to a group (idempotent).',
        security: [{ bearerAuth: [] }],
        params: userGroupParams,
      },
    }, async (request, reply) => {
      const { id, groupName } = request.params;
      const adminId = request.user.id;

      const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
      if (!user) return reply.status(404).send({ error: 'User not found' });

      const [group] = await db
        .select({ id: groups.id, name: groups.name })
        .from(groups)
        .where(eq(groups.name, groupName))
        .limit(1);
      if (!group) return reply.status(404).send({ error: 'Group not found' });

      const [existing] = await db
        .select({ userId: userGroups.userId })
        .from(userGroups)
        .where(and(eq(userGroups.userId, id), eq(userGroups.groupId, group.id)))
        .limit(1);

      if (existing) return reply.status(204).send();

      await db.transaction(async (tx) => {
        await tx.insert(userGroups).values({ userId: id, groupId: group.id });
        await recordAdminAction(tx, {
          adminUserId: adminId,
          action: 'user.group_add',
          targetType: 'user',
          targetId: id,
          metadata: { group: groupName },
        });
      });

      return reply.status(204).send();
    });

    app.delete('/admin/users/:id/groups/:groupName', {
      onRequest: rawApp.requireAdmin,
      schema: {
        tags: ['Admin'],
        summary: 'Remove user from a group. Self-removal from admin is blocked.',
        security: [{ bearerAuth: [] }],
        params: userGroupParams,
      },
    }, async (request, reply) => {
      const { id, groupName } = request.params;
      const adminId = request.user.id;

      if (groupName === ADMIN_GROUP_NAME && id === adminId) {
        return reply.status(409).send({
          error: 'self_action_blocked',
          message: 'Cannot remove yourself from admin',
        });
      }

      const [group] = await db
        .select({ id: groups.id })
        .from(groups)
        .where(eq(groups.name, groupName))
        .limit(1);
      if (!group) return reply.status(404).send({ error: 'Group not found' });

      const result = await db.transaction(async (tx) => {
        const deleted = await tx
          .delete(userGroups)
          .where(and(eq(userGroups.userId, id), eq(userGroups.groupId, group.id)))
          .returning({ userId: userGroups.userId });
        if (deleted.length > 0) {
          await recordAdminAction(tx, {
            adminUserId: adminId,
            action: 'user.group_remove',
            targetType: 'user',
            targetId: id,
            metadata: { group: groupName },
          });
        }
        return deleted.length;
      });

      if (result === 0) return reply.status(404).send({ error: 'Membership not found' });
      return reply.status(204).send();
    });
  };
}

