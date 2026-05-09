import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';

const registerSchema = z.object({
  username: z.string().min(3).max(30),
  password: z.string().min(8),
});

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export function authRoutes(db: Db) {
  return async function (app: FastifyInstance): Promise<void> {
    const { users } = schema;

    app.post('/auth/register', async (request, reply) => {
      const parsed = registerSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues });
      }
      const { username, password } = parsed.data;

      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, username))
        .limit(1);

      if (existing.length > 0) {
        return reply.status(409).send({ error: 'Username already taken' });
      }

      const passwordHash = await argon2.hash(password);
      const [user] = await db
        .insert(users)
        .values({ username, passwordHash })
        .returning({ id: users.id, username: users.username });

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

    app.post('/auth/login', async (request, reply) => {
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
        { id: user.id, username: user.username },
        { expiresIn: '7d' },
      );

      reply.setCookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/auth/refresh',
        maxAge: 7 * 24 * 60 * 60,
      });

      return reply.status(200).send({
        token: accessToken,
        user: { id: user.id, username: user.username },
      });
    });

    app.post('/auth/refresh', async (request, reply) => {
      const token = request.cookies['refreshToken'];
      if (!token) {
        return reply.status(401).send({ error: 'Missing refresh token' });
      }

      let payload: { id: string; username: string };
      try {
        payload = app.jwt.verify<{ id: string; username: string }>(token);
      } catch {
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
