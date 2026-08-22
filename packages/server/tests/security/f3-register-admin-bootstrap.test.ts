import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { createTestAppWithDb } from '../helpers/app.js';
import { schema } from '../../src/db/index.js';
import { ADMIN_GROUP_ID } from '../../src/constants/groups.js';

async function register(app: FastifyInstance, username: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { username, password: 'password123' },
  });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.statusCode} ${res.body}`);
  return res.json<{ token: string; user: { id: string; groups: string[] } }>();
}

describe('POST /auth/register never grants admin', () => {
  let app: FastifyInstance;
  let db: Awaited<ReturnType<typeof createTestAppWithDb>>['db'];

  beforeAll(async () => {
    ({ app, db } = await createTestAppWithDb());
  });

  afterAll(async () => {
    await app.close();
  });

  it('leaves the very first account on an empty database with no groups', async () => {
    const before = await db
      .select({ userId: schema.userGroups.userId })
      .from(schema.userGroups)
      .where(eq(schema.userGroups.groupId, ADMIN_GROUP_ID));
    expect(before).toEqual([]);

    const first = await register(app, 'f3-first-ever');
    expect(first.user.groups).toEqual([]);

    const memberships = await db
      .select({ userId: schema.userGroups.userId })
      .from(schema.userGroups)
      .where(eq(schema.userGroups.groupId, ADMIN_GROUP_ID));
    expect(memberships).toEqual([]);
  });

  it('does not let the first account reach an /admin route', async () => {
    const first = await register(app, 'f3-admin-probe');
    const res = await app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { Authorization: `Bearer ${first.token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('grants nothing to later registrations either', async () => {
    const later = await register(app, 'f3-second');
    expect(later.user.groups).toEqual([]);
  });
});
