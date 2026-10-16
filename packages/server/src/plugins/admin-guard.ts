import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/index.js';
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
 * `authenticate` hook uses) and then requires `request.account.isAdmin`, which
 * `verifyAccessToken` reads in its single account query.
 */
export async function registerAdminGuard(app: FastifyInstance, db: Db): Promise<void> {
  app.decorate(
    'requireAdmin',
    async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
      if (!(await verifyAccessToken(request, reply, db))) return;

      // `verifyAccessToken` already read admin membership into request.account.
      if (!request.account?.isAdmin) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
    },
  );
}
