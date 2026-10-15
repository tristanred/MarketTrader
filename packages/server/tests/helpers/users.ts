import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import * as schema from '../../src/db/schema.sqlite.js';
import type { createTestDb } from './app.js';

export type TestDb = Awaited<ReturnType<typeof createTestDb>>;

/**
 * Registers an ordinary (non-admin) user through `POST /auth/register`.
 * `remoteAddress` sets `request.ip`, for tests of per-IP and privileged limits.
 */
export async function registerUser(
  app: FastifyInstance,
  username: string,
  opts: { remoteAddress?: string } = {},
): Promise<{ token: string; userId: string; headers: { authorization: string } }> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { username, password: 'password123' },
    ...(opts.remoteAddress ? { remoteAddress: opts.remoteAddress } : {}),
  });
  if (res.statusCode !== 201) {
    throw new Error(`registerUser: register failed: ${res.statusCode} ${res.body}`);
  }
  const body = res.json<{ token: string; user: { id: string } }>();
  return { token: body.token, userId: body.user.id, headers: { authorization: `Bearer ${body.token}` } };
}

/**
 * Back-dates an account's `created_at` by `days`, e.g. to make it mature.
 * Writes SQLite's `datetime('now')` format, which is what the column holds.
 */
export async function ageAccount(db: TestDb, userId: string, days: number): Promise<void> {
  const at = new Date(Date.now() - days * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
  await db.update(schema.users).set({ createdAt: at }).where(eq(schema.users.id, userId));
}
