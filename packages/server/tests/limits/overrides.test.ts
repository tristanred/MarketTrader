import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { createTestDb } from '../helpers/app.js';
import type { TestDb } from '../helpers/users.js';
import * as schema from '../../src/db/schema.sqlite.js';
import { LimitOverridesService } from '../../src/limits/overrides.js';

async function insertUser(db: TestDb, prefix: string): Promise<string> {
  const [row] = await db
    .insert(schema.users)
    .values({ username: `${prefix}-${randomUUID().slice(0, 8)}`, passwordHash: 'x' })
    .returning({ id: schema.users.id });
  return row!.id;
}

describe('LimitOverridesService', () => {
  let db: TestDb;
  let svc: LimitOverridesService;
  let adminId: string;
  let userId: string;

  beforeEach(async () => {
    db = await createTestDb();
    svc = new LimitOverridesService(db);
    adminId = await insertUser(db, 'ov-admin');
    userId = await insertUser(db, 'ov-user');
  });

  it('returns an empty map for a user with no overrides', async () => {
    expect((await svc.forUser(userId)).size).toBe(0);
    expect(await svc.get(userId, 'gamesCreated')).toBeUndefined();
  });

  it('set() persists, invalidates the cache, and audits', async () => {
    await svc.forUser(userId); // warm the cache with "no overrides"
    await svc.set(adminId, userId, 'gamesCreated', 40, 'tournament organiser');
    expect(await svc.get(userId, 'gamesCreated')).toBe(40);

    await svc.set(adminId, userId, 'gamesCreated', 60, null);
    expect(await svc.get(userId, 'gamesCreated')).toBe(60);

    const audit = await db
      .select()
      .from(schema.adminAuditLog)
      .where(eq(schema.adminAuditLog.targetId, userId));
    expect(audit.map((r) => r.action)).toEqual(['user.limit.override', 'user.limit.override']);
    expect(JSON.parse(audit[1]!.before!)).toEqual({ key: 'gamesCreated', value: 40, note: 'tournament organiser' });
    expect(JSON.parse(audit[1]!.after!)).toEqual({ key: 'gamesCreated', value: 60, note: null });
  });

  it('listForUser() returns value, note, author and ISO time', async () => {
    await svc.set(adminId, userId, 'trades', 500, 'market maker');
    const entry = (await svc.listForUser(userId)).get('trades');
    expect(entry).toMatchObject({ value: 500, note: 'market maker', updatedBy: adminId });
    expect(entry!.updatedAt).toMatch(/Z$/);
  });

  it('clear() removes, audits once, and is idempotent', async () => {
    await svc.set(adminId, userId, 'trades', 500, null);
    expect(await svc.clear(adminId, userId, 'trades')).toBe(true);
    expect(await svc.get(userId, 'trades')).toBeUndefined();
    expect(await svc.clear(adminId, userId, 'trades')).toBe(false);

    const resets = await db
      .select()
      .from(schema.adminAuditLog)
      .where(eq(schema.adminAuditLog.action, 'user.limit.reset'));
    expect(resets.filter((r) => r.targetId === userId)).toHaveLength(1);
  });

  it('listAll() names the user and the admin', async () => {
    await svc.set(adminId, userId, 'openOrders', 200, 'bot test');
    const entry = (await svc.listAll()).find((e) => e.userId === userId);
    expect(entry).toMatchObject({ key: 'openOrders', value: 200, note: 'bot test', updatedBy: adminId });
    expect(entry!.username).toMatch(/^ov-user-/);
    expect(entry!.updatedByUsername).toMatch(/^ov-admin-/);
  });

  it('ignores rows whose key is no longer a LimitKey', async () => {
    await db.insert(schema.userLimitOverrides).values({ userId, limitKey: 'retiredLimit', value: 3 });
    expect((await svc.forUser(userId)).size).toBe(0);
    expect((await svc.listAll()).some((e) => e.userId === userId)).toBe(false);
  });

  it('cascades when the user is deleted', async () => {
    await svc.set(adminId, userId, 'trades', 500, null);
    await db.delete(schema.adminAuditLog).where(eq(schema.adminAuditLog.targetId, userId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    const rows = await db
      .select()
      .from(schema.userLimitOverrides)
      .where(eq(schema.userLimitOverrides.userId, userId));
    expect(rows).toHaveLength(0);
  });
});
