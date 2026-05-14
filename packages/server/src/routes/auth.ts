import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { hash, verify } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import { env } from '../env.js';

const REFRESH_COOKIE_PATH = '/auth/refresh';
const REFRESH_TOKEN_MAX_AGE_S = 7 * 24 * 60 * 60;

/**
 * Issues a 7-day HttpOnly `refreshToken` cookie scoped to {@link REFRESH_COOKIE_PATH}.
 * Browsers overwrite same-name/path cookies, so calling this on register or
 * login also evicts any leftover cookie from a previous user on the device.
 */
function issueRefreshCookie(
  app: FastifyInstance,
  reply: FastifyReply,
  payload: { id: string; username: string },
): void {
  const refreshToken = app.jwt.sign(
    { ...payload, type: 'refresh' as const },
    { expiresIn: '7d' },
  );
  reply.setCookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_TOKEN_MAX_AGE_S,
  });
}

const registerSchema = z.object({
  username: z.string().min(3).max(30),
  password: z.string().min(8),
});

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

/**
 * Registers all authentication routes on the Fastify instance:
 * - `POST /auth/register` — create a new account; sets the refresh cookie and returns a 15-minute access token.
 * - `POST /auth/login`    — verify credentials; sets the refresh cookie and returns a 15-minute access token.
 * - `POST /auth/refresh`  — exchange the refresh-token cookie for a new access token.
 * - `POST /auth/logout`   — clear the refresh-token cookie (idempotent, no auth required).
 *
 * Rate limits are applied per-route to slow brute-force attempts.
 * Passwords are hashed with argon2; never bcrypt.
 */
export function authRoutes(db: Db) {
  return async function (rawApp: FastifyInstance): Promise<void> {
    const app = rawApp.withTypeProvider<ZodTypeProvider>();
    const { users } = schema;

    app.post('/auth/register', {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['Auth'],
        summary: 'Create a new account and issue a 15-minute access token.',
        body: registerSchema,
      },
    }, async (request, reply) => {
      const { username, password } = request.body;

      const passwordHash = await hash(password);
      let user: { id: string; username: string } | undefined;
      try {
        const [inserted] = await db
          .insert(users)
          .values({ username, passwordHash })
          .returning({ id: users.id, username: users.username });
        user = inserted;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('UNIQUE constraint failed') || msg.includes('unique constraint')) {
          return reply.status(409).send({ error: 'Username already taken' });
        }
        throw err;
      }

      if (!user) {
        return reply.status(500).send({ error: 'Failed to create user' });
      }

      const token = app.jwt.sign(
        { id: user.id, username: user.username },
        { expiresIn: '15m' },
      );

      // Issue the refresh cookie on register too: same-name/path overwrite
      // evicts any leftover cookie from a previous user on this device,
      // closing the cross-session bleed-through where /auth/refresh would
      // otherwise hand back the previous user's identity.
      issueRefreshCookie(app, reply, { id: user.id, username: user.username });

      return reply.status(201).send({
        token,
        user: { id: user.id, username: user.username },
      });
    });

    app.post('/auth/login', {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        tags: ['Auth'],
        summary: 'Verify credentials and issue a 15-minute access token.',
        body: loginSchema,
      },
    }, async (request, reply) => {
      const { username, password } = request.body;

      const [user] = await db
        .select({ id: users.id, username: users.username, passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.username, username))
        .limit(1);

      if (!user) {
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      const valid = await verify(user.passwordHash, password);
      if (!valid) {
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      const accessToken = app.jwt.sign(
        { id: user.id, username: user.username },
        { expiresIn: '15m' },
      );

      issueRefreshCookie(app, reply, { id: user.id, username: user.username });

      return reply.status(200).send({
        token: accessToken,
        user: { id: user.id, username: user.username },
      });
    });

    app.post('/auth/logout', {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['Auth'],
        summary: 'Clear the refresh-token cookie (idempotent).',
      },
    }, async (_request, reply) => {
      // Idempotent: clearing always succeeds, whether or not a cookie was set.
      // Identity is not verified — sign-out must work even after the access
      // token has expired or the refresh cookie has rotted.
      reply.clearCookie('refreshToken', { path: REFRESH_COOKIE_PATH });
      return reply.status(204).send();
    });

    app.post('/auth/refresh', {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['Auth'],
        summary: 'Exchange the refresh-token cookie for a new access token.',
      },
    }, async (request, reply) => {
      const token = request.cookies['refreshToken'];
      if (!token) {
        return reply.status(401).send({ error: 'Missing refresh token' });
      }

      let payload: { id: string; username: string; type?: string };
      try {
        payload = app.jwt.verify<{ id: string; username: string; type?: string }>(token);
      } catch {
        return reply.status(401).send({ error: 'Invalid refresh token' });
      }

      if (payload.type !== 'refresh') {
        return reply.status(401).send({ error: 'Invalid refresh token' });
      }

      const accessToken = app.jwt.sign(
        { id: payload.id, username: payload.username },
        { expiresIn: '15m' },
      );

      return reply.status(200).send({
        token: accessToken,
        user: { id: payload.id, username: payload.username },
      });
    });
  };
}
