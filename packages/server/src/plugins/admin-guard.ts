import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import { ADMIN_GROUP_ID } from '../constants/groups.js';
import { verifyAccessToken } from './jwt.js';

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * Pre-handler enforcing that the request bears a valid JWT AND the
     * authenticated user is a member of the `admin` group. Returns 401 on
     * missing/invalid token, 403 on missing admin membership.
     */
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/**
 * Decorates the Fastify instance with `requireAdmin`, a pre-handler that
 * validates the bearer JWT (through the same {@link verifyAccessToken} the
 * `authenticate` hook uses) and then checks `user_groups` for membership in
 * the `admin` group.
 */
export async function registerAdminGuard(app: FastifyInstance, db: Db): Promise<void> {
  app.decorate(
    'requireAdmin',
    async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
      if (!(await verifyAccessToken(request, reply, db))) return;

      const userId = request.user.id;
      const [membership] = await db
        .select({ userId: schema.userGroups.userId })
        .from(schema.userGroups)
        .where(
          and(
            eq(schema.userGroups.userId, userId),
            eq(schema.userGroups.groupId, ADMIN_GROUP_ID),
          ),
        )
        .limit(1);

      if (!membership) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
    },
  );
}
