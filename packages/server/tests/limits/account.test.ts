import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { createTestAppWithDb, registerAdmin } from '../helpers/app.js';
import { registerUser, type TestDb } from '../helpers/users.js';
import { loadAccount, toIsoUtc, type RequestAccount } from '../../src/limits/account.js';
import * as schema from '../../src/db/schema.sqlite.js';
import { ADMIN_GROUP_ID } from '../../src/constants/groups.js';

describe('toIsoUtc', () => {
  it.each([
    ['2026-10-14 12:00:00', '2026-10-14T12:00:00.000Z'],
    ['2026-10-14 12:00:00.123456', '2026-10-14T12:00:00.123Z'],
    ['2026-10-14T12:00:00.000Z', '2026-10-14T12:00:00.000Z'],
    ['2026-10-14 14:00:00+02', '2026-10-14T12:00:00.000Z'],
    ['2026-10-14 14:00:00+02:00', '2026-10-14T12:00:00.000Z'],
  ])('%j → %j', (input, expected) => {
    expect(toIsoUtc(input)).toBe(expected);
  });

  it('returns an unparseable value unchanged', () => {
    expect(toIsoUtc('garbage')).toBe('garbage');
  });
});

describe('request.account', () => {
  let app: FastifyInstance;
  let db: TestDb;

  beforeAll(async () => {
    ({ app, db } = await createTestAppWithDb());
    // Must be added before the first inject — routes cannot be added once ready.
    app.get('/__account', { onRequest: app.authenticate }, async (request) => request.account ?? null);
  });

  afterAll(async () => {
    await app.close();
  });

  it('is set for an ordinary user with an ISO createdAt and isAdmin false', async () => {
    const user = await registerUser(app, 'acct-member');
    const res = await app.inject({ method: 'GET', url: '/__account', headers: user.headers });
    const account = res.json<RequestAccount>();
    expect(account.id).toBe(user.userId);
    expect(account.isAdmin).toBe(false);
    expect(account.createdAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  });

  it('is isAdmin true for an admin, and false on the next request after demotion', async () => {
    const admin = await registerAdmin(app, 'acct-admin');
    const headers = { authorization: `Bearer ${admin.token}` };
    expect((await app.inject({ method: 'GET', url: '/__account', headers })).json<RequestAccount>().isAdmin).toBe(true);

    await db
      .delete(schema.userGroups)
      .where(and(eq(schema.userGroups.userId, admin.userId), eq(schema.userGroups.groupId, ADMIN_GROUP_ID)));
    expect((await app.inject({ method: 'GET', url: '/__account', headers })).json<RequestAccount>().isAdmin).toBe(false);
  });

  it('loadAccount reports disabled and undefined for unknown users', async () => {
    const user = await registerUser(app, 'acct-disabled');
    await db.update(schema.users).set({ disabled: true }).where(eq(schema.users.id, user.userId));
    expect((await loadAccount(db, user.userId))?.disabled).toBe(true);
    expect(await loadAccount(db, 'no-such-user')).toBeUndefined();
  });

  it('requireAdmin still answers 403 to a member and 200 to an admin', async () => {
    const member = await registerUser(app, 'acct-guard-member');
    const admin = await registerAdmin(app, 'acct-guard-admin');
    expect((await app.inject({ method: 'GET', url: '/admin/config', headers: member.headers })).statusCode).toBe(403);
    expect(
      (await app.inject({ method: 'GET', url: '/admin/config', headers: { authorization: `Bearer ${admin.token}` } }))
        .statusCode,
    ).toBe(200);
  });
});
