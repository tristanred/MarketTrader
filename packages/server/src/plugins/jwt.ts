import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import { env } from '../env.js';

/**
 * The `type` claim separating the two tokens signed with the same key. Without
 * it they are interchangeable, and the 7-day refresh token authenticates
 * everything the 15-minute access token does.
 */
export const ACCESS_TOKEN_TYPE = 'access';
export const REFRESH_TOKEN_TYPE = 'refresh';

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '7d';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { id: string; username: string; type?: string };
    user: { id: string; username: string; type?: string };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/** Signs the 15-minute bearer token. The only credential the REST guards accept. */
export function signAccessToken(
  app: FastifyInstance,
  payload: { id: string; username: string },
): string {
  return app.jwt.sign({ ...payload, type: ACCESS_TOKEN_TYPE }, { expiresIn: ACCESS_TOKEN_TTL });
}

/** Signs the 7-day token that only `POST /auth/refresh` and nothing else will accept. */
export function signRefreshToken(
  app: FastifyInstance,
  payload: { id: string; username: string },
): string {
  return app.jwt.sign({ ...payload, type: REFRESH_TOKEN_TYPE }, { expiresIn: REFRESH_TOKEN_TTL });
}

/**
 * Verifies the bearer JWT and returns false — having already sent the 401 —
 * for anything that is not a live access token: a bad signature, a refresh
 * token, a token with no `type` claim at all, or one naming a user since
 * disabled or deleted.
 *
 * Requiring `type === 'access'` rather than rejecting `'refresh'` is what makes
 * an unstamped token fail closed. The live `users` read is what makes
 * `PATCH /admin/users/:id {disabled:true}` take effect on the next request
 * instead of at the next token expiry.
 *
 * Every rejection sends the same body: distinguishing them would turn the hook
 * into an oracle for which accounts exist and which are banned.
 */
export async function verifyAccessToken(
  request: FastifyRequest,
  reply: FastifyReply,
  db: Db,
): Promise<boolean> {
  const unauthorized = (): boolean => {
    void reply.code(401).send({ error: 'Unauthorized' });
    return false;
  };

  try {
    await request.jwtVerify();
  } catch {
    return unauthorized();
  }

  if (request.user.type !== ACCESS_TOKEN_TYPE) {
    return unauthorized();
  }

  const [current] = await db
    .select({ disabled: schema.users.disabled })
    .from(schema.users)
    .where(eq(schema.users.id, request.user.id))
    .limit(1);

  if (!current || current.disabled) {
    return unauthorized();
  }

  return true;
}

/**
 * Registers `@fastify/jwt` and decorates the instance with `authenticate`, the
 * `onRequest` guard every protected REST route uses. Needs `db` because the
 * guard re-checks the account on each request — see {@link verifyAccessToken}.
 */
export async function registerJwt(app: FastifyInstance, db: Db): Promise<void> {
  await app.register(fastifyJwt, { secret: env.JWT_SECRET });

  app.decorate(
    'authenticate',
    async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
      await verifyAccessToken(request, reply, db);
    },
  );
}
