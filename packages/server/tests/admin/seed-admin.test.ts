import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { hash, verify } from '@node-rs/argon2';
import { createTestDb } from '../helpers/app.js';
import {
  SEEDED_ADMIN_USERNAME,
  ensureSeededAdmin,
  shouldSeedAdminOnBoot,
  firstFreeAdminUsername,
} from '../../src/db/seed-admin.js';
import { schema } from '../../src/db/index.js';
import { ADMIN_GROUP_ID } from '../../src/constants/groups.js';

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

async function adminMembers(db: TestDb): Promise<string[]> {
  const rows = await db
    .select({ username: schema.users.username })
    .from(schema.userGroups)
    .innerJoin(schema.users, eq(schema.users.id, schema.userGroups.userId))
    .where(eq(schema.userGroups.groupId, ADMIN_GROUP_ID));
  return rows.map((r) => r.username);
}

// The in-memory SQLite is shared within a Vitest worker, so every test clears
// the tables the seed inspects rather than assuming a fresh database.
async function reset(db: TestDb): Promise<void> {
  await db.delete(schema.userGroups);
  await db.delete(schema.users);
}

describe('ensureSeededAdmin', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
    await reset(db);
  });

  it('creates an admin with a random password on an empty database', async () => {
    const credentials = await ensureSeededAdmin(db);
    expect(credentials).not.toBeNull();
    expect(credentials?.username).toBe(SEEDED_ADMIN_USERNAME);
    expect(credentials?.password.length).toBeGreaterThanOrEqual(24);
    expect(await adminMembers(db)).toEqual([SEEDED_ADMIN_USERNAME]);
  });

  it('stores an argon2 hash that verifies against the printed password', async () => {
    const credentials = await ensureSeededAdmin(db);
    const [row] = await db
      .select({ passwordHash: schema.users.passwordHash })
      .from(schema.users)
      .where(eq(schema.users.username, SEEDED_ADMIN_USERNAME))
      .limit(1);
    expect(row?.passwordHash.startsWith('$argon2')).toBe(true);
    expect(await verify(row!.passwordHash, credentials!.password)).toBe(true);
  });

  it('generates a different password each time it seeds', async () => {
    const first = await ensureSeededAdmin(db);
    await reset(db);
    const second = await ensureSeededAdmin(db);
    expect(first?.password).not.toBe(second?.password);
  });

  it('is idempotent: a second boot creates nothing and returns null', async () => {
    const first = await ensureSeededAdmin(db);
    const second = await ensureSeededAdmin(db);
    expect(second).toBeNull();
    expect(await adminMembers(db)).toEqual([first!.username]);

    const [row] = await db
      .select({ passwordHash: schema.users.passwordHash })
      .from(schema.users)
      .where(eq(schema.users.username, first!.username))
      .limit(1);
    expect(await verify(row!.passwordHash, first!.password)).toBe(true);
  });

  it('does not re-seed when some other account already holds admin', async () => {
    const [existing] = await db
      .insert(schema.users)
      .values({ username: 'promoted-human', passwordHash: await hash('password123') })
      .returning({ id: schema.users.id });
    await db
      .insert(schema.userGroups)
      .values({ userId: existing!.id, groupId: ADMIN_GROUP_ID });

    expect(await ensureSeededAdmin(db)).toBeNull();
    expect(await adminMembers(db)).toEqual(['promoted-human']);
  });

  it('uses a suffixed name and never promotes a squatter on "admin"', async () => {
    await db
      .insert(schema.users)
      .values({ username: SEEDED_ADMIN_USERNAME, passwordHash: await hash('password123') });

    const credentials = await ensureSeededAdmin(db);
    expect(credentials?.username).toBe('admin-2');
    expect(await adminMembers(db)).toEqual([credentials!.username]);
  });
});

describe('firstFreeAdminUsername', () => {
  it('walks a deterministic sequence past every taken name', () => {
    expect(firstFreeAdminUsername(new Set())).toBe('admin');
    expect(firstFreeAdminUsername(new Set(['admin']))).toBe('admin-2');
    expect(firstFreeAdminUsername(new Set(['admin', 'admin-2']))).toBe('admin-3');
    // Unrelated names that merely share the prefix must not shift the sequence.
    expect(firstFreeAdminUsername(new Set(['administrator']))).toBe('admin');
  });

  it('is deterministic, which is what makes concurrent seeding safe', () => {
    // Two servers booting at the same instant must choose the SAME name, so the
    // unique index on users.username rejects the loser. A random suffix would
    // let both succeed and seed two administrators.
    const taken = new Set(['admin']);
    expect(firstFreeAdminUsername(taken)).toBe(firstFreeAdminUsername(new Set(taken)));
  });
});

describe('shouldSeedAdminOnBoot', () => {
  it('runs for a durable database outside the test environment', () => {
    expect(shouldSeedAdminOnBoot('production', 'postgres://host/db')).toBe(true);
    expect(shouldSeedAdminOnBoot('development', './dev.db')).toBe(true);
  });

  it('never runs under NODE_ENV=test', () => {
    expect(shouldSeedAdminOnBoot('test', './dev.db')).toBe(false);
  });

  it('never runs against an in-memory database, normalized or not', () => {
    expect(shouldSeedAdminOnBoot('development', ':memory:')).toBe(false);
    expect(shouldSeedAdminOnBoot('development', 'file::memory:?cache=shared')).toBe(false);
  });
});
