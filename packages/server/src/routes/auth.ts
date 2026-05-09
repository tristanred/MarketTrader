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
  };
}
