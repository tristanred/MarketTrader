import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestAppWithDb, registerAdmin, type createTestDb } from '../helpers/app.js';
import { registerUser } from '../helpers/users.js';
import { schema } from '../../src/db/index.js';
import { flushUsage } from '../../src/limits/usage-store.js';

describe('DELETE /admin/users/:id removes usage history', () => {
  let app: FastifyInstance;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let admin: { authorization: string };

  beforeAll(async () => {
    ({ app, db } = await createTestAppWithDb());
    admin = { authorization: `Bearer ${(await registerAdmin(app, 'usage-del-admin')).token}` };
  });

  afterAll(async () => {
    await app.close();
  });

  it('deletes the user’s rows and leaves everyone else’s', async () => {
    const victim = await registerUser(app, 'usage-del-victim');
    const bystander = await registerUser(app, 'usage-del-bystander');
    await db.insert(schema.apiUsageHourly).values([
      { subjectType: 'user', subjectId: victim.userId, route: 'GET /games', hourStart: '2026-10-14T13:00:00.000Z', count: 4 },
      { subjectType: 'user', subjectId: bystander.userId, route: 'GET /games', hourStart: '2026-10-14T13:00:00.000Z', count: 1 },
    ]);
    await db.insert(schema.limitDenialsHourly).values({
      subjectType: 'user', subjectId: victim.userId, limitKey: 'trades',
      hourStart: '2026-10-14T13:00:00.000Z', count: 2,
      firstAt: '2026-10-14T13:01:00.000Z', lastAt: '2026-10-14T13:02:00.000Z',
    });

    const res = await app.inject({ method: 'DELETE', url: `/admin/users/${victim.userId}?force=true`, headers: admin });
    expect(res.statusCode).toBe(204);

    const usage = await db.select().from(schema.apiUsageHourly);
    expect(usage.map((r) => r.subjectId)).toEqual([bystander.userId]);
    expect(await db.select().from(schema.limitDenialsHourly)).toHaveLength(0);
  });

  it('drops the user’s unflushed counts so a later flush cannot write them back', async () => {
    const victim = await registerUser(app, 'usage-del-buffered');
    const tracker = app.limits.tracker;
    tracker.recordRequest({ type: 'user', id: victim.userId }, 'GET /games');
    tracker.recordDenial({ type: 'user', id: victim.userId }, 'trades');

    const res = await app.inject({ method: 'DELETE', url: `/admin/users/${victim.userId}?force=true`, headers: admin });
    expect(res.statusCode).toBe(204);
    await flushUsage(db, tracker.swap());

    // Whole-table asserts would trip on the admin's and the registration IP's own rows.
    const usage = await db.select().from(schema.apiUsageHourly);
    expect(usage.filter((r) => r.subjectId === victim.userId)).toEqual([]);
    const denials = await db.select().from(schema.limitDenialsHourly);
    expect(denials.filter((r) => r.subjectId === victim.userId)).toEqual([]);
  });
});
