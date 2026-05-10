import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import { env } from '../env.js';

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
 * - `POST /auth/register` — create a new account; returns a 15-minute access token.
 * - `POST /auth/login`    — verify credentials; sets an HttpOnly refresh-token cookie
 *   and returns a 15-minute access token.
 * - `POST /auth/refresh`  — exchange the refresh-token cookie for a new access token.
 *
 * Rate limits are applied per-route to slow brute-force attempts.
 * Passwords are hashed with argon2; never bcrypt.
 */
export function authRoutes(db: Db) {
  return async function (app: FastifyInstance): Promise<void> {
    const { users } = schema;

    app.post('/auth/register', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
      const parsed = registerSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues });
      }
      const { username, password } = parsed.data;

      const passwordHash = await argon2.hash(password);
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

      return reply.status(201).send({
        token,
        user: { id: user.id, username: user.username },
      });
    });

    app.post('/auth/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues });
      }
      const { username, password } = parsed.data;

      const [user] = await db
        .select({ id: users.id, username: users.username, passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.username, username))
        .limit(1);

      if (!user) {
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      const valid = await argon2.verify(user.passwordHash, password);
      if (!valid) {
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      const accessToken = app.jwt.sign(
        { id: user.id, username: user.username },
        { expiresIn: '15m' },
      );

      const refreshToken = app.jwt.sign(
        { id: user.id, username: user.username, type: 'refresh' as const },
        { expiresIn: '7d' },
      );

      // Scope the cookie to /auth/refresh so it is never sent on other requests.
      reply.setCookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/auth/refresh',
        maxAge: 7 * 24 * 60 * 60,
      });

      return reply.status(200).send({
        token: accessToken,
        user: { id: user.id, username: user.username },
      });
    });

    app.post('/auth/refresh', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
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
