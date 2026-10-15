import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import type {
  AdminLimitOverrideEntry,
  AdminLimitPolicy,
  AdminTopConsumersResponse,
  AdminUserLimitRow,
  AdminUserLimitsResponse,
} from '@markettrader/shared';
import { createTestAppWithDb, registerAdmin, type createTestDb } from '../helpers/app.js';
import { registerUser } from '../helpers/users.js';
import { RuntimeConfig } from '../../src/config/runtime-config.js';
import { schema } from '../../src/db/index.js';

const DAY = 86_400_000;

function gamePayload(name: string) {
  const now = Date.now();
  return {
    name,
    startDate: new Date(now).toISOString(),
    endDate: new Date(now + 30 * DAY).toISOString(),
    startingBalance: 100_000,
  };
}

describe('/admin/limits and /admin/users/:id/limits', () => {
  let app: FastifyInstance;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let admin: { authorization: string };
  let adminId: string;
  let member: { authorization: string };
  let memberId: string;

  beforeAll(async () => {
    ({ app, db } = await createTestAppWithDb(undefined, undefined, {
      limits: { disabled: false },
      runtimeConfig: RuntimeConfig.fromEnvironment({
        LIMITS_PRIVILEGED_CIDRS: '10.0.0.0/8',
        LIMIT_REGISTRATIONS_PER_IP_PER_DAY: 100,
      }),
    }));
    const a = await registerAdmin(app, 'lim-admin');
    admin = { authorization: `Bearer ${a.token}` };
    adminId = a.userId;
    const m = await registerUser(app, 'lim-member');
    member = { authorization: `Bearer ${m.token}` };
    memberId = m.userId;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects unauthenticated (401) and non-admin (403) callers', async () => {
    for (const url of ['/admin/limits/policy', '/admin/limits/top', '/admin/limits/overrides', `/admin/users/${memberId}/limits`]) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
      expect((await app.inject({ method: 'GET', url, headers: member })).statusCode).toBe(403);
    }
    const put = await app.inject({
      method: 'PUT', url: `/admin/users/${memberId}/limits/gamesCreated`, headers: member, payload: { value: 5 },
    });
    expect(put.statusCode).toBe(403);
  });

  it('reports the policy and the caller IP as the server sees it', async () => {
    const privileged = await app.inject({
      method: 'GET', url: '/admin/limits/policy', headers: admin, remoteAddress: '10.1.2.3',
    });
    expect(privileged.statusCode).toBe(200);
    expect(privileged.json<AdminLimitPolicy>()).toMatchObject({
      enabled: true,
      maturityDays: 7,
      probationPercent: 25,
      privilegedCidrs: ['10.0.0.0/8'],
      privilegedMultiplier: 10,
      requestIp: '10.1.2.3',
      requestIpPrivileged: true,
    });

    const outside = await app.inject({
      method: 'GET', url: '/admin/limits/policy', headers: admin, remoteAddress: '203.0.113.7',
    });
    expect(outside.json<AdminLimitPolicy>()).toMatchObject({ requestIp: '203.0.113.7', requestIpPrivileged: false });
  });

  it('shows a new user on probation with live usage counts', async () => {
    const created = await app.inject({ method: 'POST', url: '/games', headers: member, payload: gamePayload('lim g1') });
    expect(created.statusCode).toBe(201);

    const res = await app.inject({ method: 'GET', url: `/admin/users/${memberId}/limits`, headers: admin });
    expect(res.statusCode).toBe(200);
    const body = res.json<AdminUserLimitsResponse>();
    expect(body.userId).toBe(memberId);
    expect(body.mature).toBe(false);
    expect(body.probationEndsAt).not.toBeNull();
    expect(body.privilegedMultiplier).toBe(10);

    const gamesCreated = body.rows.find((r) => r.key === 'gamesCreated')!;
    expect(gamesCreated).toMatchObject({
      kind: 'quota',
      configKey: 'LIMIT_GAMES_CREATED_PER_WEEK',
      baseValue: 10,
      effectiveMax: 3,
      basis: 'probation',
      override: null,
      used: 1,
      overridable: true,
    });
    expect(body.rows.find((r) => r.key === 'activeGamesJoined')!.used).toBe(1);
    expect(body.rows.find((r) => r.key === 'wsConnections')!.used).toBe(0);
    expect(body.rows.find((r) => r.key === 'registrationsPerIp')!.overridable).toBe(false);
    expect(body.rows.map((r) => r.key)).toHaveLength(14);
  });

  // Review Focus #4: an override below current usage is reported as-is (used > max), not clamped.
  it('reports usage above an override that was lowered beneath it', async () => {
    // Its own user: the shared member's game count feeds the top-consumers test below.
    const owner = await registerUser(app, 'lim-lowered');
    for (const name of ['low g1', 'low g2']) {
      const res = await app.inject({ method: 'POST', url: '/games', headers: owner.headers, payload: gamePayload(name) });
      expect(res.statusCode).toBe(201);
    }
    const put = await app.inject({
      method: 'PUT',
      url: `/admin/users/${owner.userId}/limits/activeGamesOwned`,
      headers: admin,
      payload: { value: 1, note: 'below usage' },
    });
    expect(put.statusCode).toBe(200);

    const res = await app.inject({ method: 'GET', url: `/admin/users/${owner.userId}/limits`, headers: admin });
    const row = res.json<AdminUserLimitsResponse>().rows.find((r) => r.key === 'activeGamesOwned')!;
    expect(row).toMatchObject({ basis: 'override', effectiveMax: 1, used: 2 });
  });

  it('marks an admin as immune', async () => {
    const res = await app.inject({ method: 'GET', url: `/admin/users/${adminId}/limits`, headers: admin });
    const row = res.json<AdminUserLimitsResponse>().rows.find((r) => r.key === 'trades')!;
    expect(row).toMatchObject({ basis: 'admin', effectiveMax: null });
  });

  it('sets, lists, audits, and clears an override', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: `/admin/users/${memberId}/limits/gamesCreated`,
      headers: admin,
      payload: { value: 40, note: 'office organiser' },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json<AdminUserLimitRow>()).toMatchObject({
      key: 'gamesCreated',
      effectiveMax: 40,
      basis: 'override',
      override: { value: 40, note: 'office organiser' },
    });

    const list = await app.inject({ method: 'GET', url: '/admin/limits/overrides', headers: admin });
    expect(list.json<AdminLimitOverrideEntry[]>()).toContainEqual(
      expect.objectContaining({ userId: memberId, username: 'lim-member', key: 'gamesCreated', value: 40 }),
    );

    const audit = await db
      .select()
      .from(schema.adminAuditLog)
      .where(and(eq(schema.adminAuditLog.action, 'user.limit.override'), eq(schema.adminAuditLog.targetId, memberId)));
    expect(audit).toHaveLength(1);

    const del = await app.inject({ method: 'DELETE', url: `/admin/users/${memberId}/limits/gamesCreated`, headers: admin });
    expect(del.statusCode).toBe(200);
    expect(del.json<AdminUserLimitRow>()).toMatchObject({ basis: 'probation', effectiveMax: 3, override: null });

    const reset = await db
      .select()
      .from(schema.adminAuditLog)
      .where(and(eq(schema.adminAuditLog.action, 'user.limit.reset'), eq(schema.adminAuditLog.targetId, memberId)));
    expect(reset).toHaveLength(1);
  });

  it('validates override keys and values', async () => {
    const put = (key: string, payload: Record<string, unknown>, id = memberId) =>
      app.inject({ method: 'PUT', url: `/admin/users/${id}/limits/${key}`, headers: admin, payload });

    const unknownKey = await put('notALimit', { value: 5 });
    expect(unknownKey.statusCode).toBe(404);
    expect(unknownKey.json()).toMatchObject({ code: 'UNKNOWN_LIMIT_KEY' });

    const ipKind = await put('registrationsPerIp', { value: 5 });
    expect(ipKind.statusCode).toBe(409);
    expect(ipKind.json()).toMatchObject({ code: 'LIMIT_NOT_OVERRIDABLE' });

    // LIMIT_GAMES_CREATED_PER_WEEK's registry ceiling is 10 000.
    const tooHigh = await put('gamesCreated', { value: 10_001 });
    expect(tooHigh.statusCode).toBe(400);
    expect(tooHigh.json()).toMatchObject({ code: 'INVALID_LIMIT_VALUE' });

    expect((await put('gamesCreated', { value: 0 })).statusCode).toBe(400);
    expect((await put('gamesCreated', { value: 2.5 })).statusCode).toBe(400);
    expect((await put('gamesCreated', { value: 5, note: 'x'.repeat(501) })).statusCode).toBe(400);
    expect((await put('gamesCreated', { value: 5 }, 'no-such-user')).statusCode).toBe(404);
  });

  it('lists accounts sharing a registration IP', async () => {
    const a = await registerUser(app, 'lim-sib-a', { remoteAddress: '192.0.2.77' });
    const b = await registerUser(app, 'lim-sib-b', { remoteAddress: '192.0.2.77' });

    const res = await app.inject({ method: 'GET', url: `/admin/users/${a.userId}/limits`, headers: admin });
    const body = res.json<AdminUserLimitsResponse>();
    expect(body.registrationIp).toBe('192.0.2.77');
    expect(body.siblingAccounts.map((s) => s.id)).toEqual([b.userId]);
    expect(body.rows.find((r) => r.key === 'registrationsPerIp')!.used).toBe(2);
  });

  it('ranks top consumers and shows a user’s volume and denials', async () => {
    for (let i = 0; i < 3; i++) {
      expect((await app.inject({ method: 'GET', url: '/games', headers: member })).statusCode).toBe(200);
    }
    // Force a denial: an override of 1 while the member already created one game this week.
    await app.inject({
      method: 'PUT', url: `/admin/users/${memberId}/limits/gamesCreated`, headers: admin, payload: { value: 1 },
    });
    const denied = await app.inject({ method: 'POST', url: '/games', headers: member, payload: gamePayload('lim g2') });
    expect(denied.statusCode).toBe(429);

    const top = await app.inject({ method: 'GET', url: '/admin/limits/top?metric=requests&window=24h', headers: admin });
    expect(top.statusCode).toBe(200);
    const topBody = top.json<AdminTopConsumersResponse>();
    expect(topBody).toMatchObject({ window: '24h', metric: 'requests' });
    const memberRow = topBody.rows.find((r) => r.subjectId === memberId)!;
    expect(memberRow).toMatchObject({ subjectType: 'user', username: 'lim-member' });
    expect(memberRow.count).toBeGreaterThanOrEqual(3);

    const denials = await app.inject({ method: 'GET', url: '/admin/limits/top?metric=denials', headers: admin });
    expect(denials.json<AdminTopConsumersResponse>().rows).toContainEqual(
      expect.objectContaining({ subjectId: memberId, top: 'gamesCreated' }),
    );

    const detail = await app.inject({ method: 'GET', url: `/admin/users/${memberId}/limits`, headers: admin });
    const body = detail.json<AdminUserLimitsResponse>();
    expect(body.requestVolume7d).toContainEqual(expect.objectContaining({ route: 'GET /games' }));
    expect(body.denials7d).toContainEqual(expect.objectContaining({ limitKey: 'gamesCreated', count: 1 }));

    const bad = await app.inject({ method: 'GET', url: '/admin/limits/top?window=1y', headers: admin });
    expect(bad.statusCode).toBe(400);

    await app.inject({ method: 'DELETE', url: `/admin/users/${memberId}/limits/gamesCreated`, headers: admin });
  });
});
