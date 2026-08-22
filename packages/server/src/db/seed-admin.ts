import { randomBytes } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { eq, like } from 'drizzle-orm';
import type { Db } from './index.js';
import * as schema from './schema.sqlite.js';
import { ADMIN_GROUP_ID } from '../constants/groups.js';
import { env, isRemoteDatabaseUrl } from '../env.js';

/** Preferred username for the seeded administrator. */
export const SEEDED_ADMIN_USERNAME = 'admin';

/** 24 random bytes of base64url — 192 bits of CSPRNG entropy, shell-safe. */
const PASSWORD_BYTES = 24;

/**
 * Credentials for a freshly seeded administrator. The plaintext password
 * exists only in memory, is shown to the operator once, and is never stored.
 */
export interface SeededAdminCredentials {
  username: string;
  password: string;
}

/**
 * Decides whether the boot path should seed an administrator. Kept pure so the
 * skip conditions can be asserted without booting a server: the test suite and
 * in-memory databases must stay deterministic and silent.
 */
export function shouldSeedAdminOnBoot(nodeEnv: string, databaseUrl: string): boolean {
  if (nodeEnv === 'test') return false;
  // Postgres and remote libsql are always durable. Checked first, and ahead of
  // the substring test below, so a password that happens to contain ":memory:"
  // cannot make a real database look ephemeral — `env.ts` orders it the same way.
  if (isRemoteDatabaseUrl(databaseUrl)) return true;
  // `normalizeLibsqlUrl` rewrites `:memory:` to `file::memory:?cache=shared`,
  // so match the substring the way `db/index.ts` does.
  return !databaseUrl.includes(':memory:');
}

/**
 * First name in the deterministic sequence `admin`, `admin-2`, `admin-3`, …
 * that `taken` does not already hold.
 *
 * Deterministic on purpose. A random suffix would let two servers booting at
 * the same instant against one PostgreSQL database pick *different* names,
 * insert both, and seed two administrators — READ COMMITTED lets both see no
 * admin row. Choosing the same name makes the unique index on `users.username`
 * the arbiter: the loser's transaction aborts, which is already how the
 * uncontended case stays safe.
 */
export function firstFreeAdminUsername(taken: ReadonlySet<string>): string {
  if (!taken.has(SEEDED_ADMIN_USERNAME)) return SEEDED_ADMIN_USERNAME;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${SEEDED_ADMIN_USERNAME}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Creates the platform's first administrator if — and only if — no account
 * currently belongs to the `admin` group. Returns the generated credentials on
 * the run that creates the account and `null` on every run afterwards, so a
 * restart never resets or re-prints an existing admin's password.
 *
 * Falls back to the next free `admin-<n>` when the `admin` username is already
 * taken; a squatting account is never promoted, since that would hand admin to
 * whoever registered it. Throws if the `admin` group row is missing (migrations
 * unapplied).
 */
export async function ensureSeededAdmin(db: Db): Promise<SeededAdminCredentials | null> {
  const { users, userGroups, groups } = schema;

  const [adminGroup] = await db
    .select({ id: groups.id })
    .from(groups)
    .where(eq(groups.id, ADMIN_GROUP_ID))
    .limit(1);
  if (!adminGroup) {
    throw new Error('admin group row is missing; run migrations before seeding an admin');
  }

  // Cheap pre-check so an already-seeded instance pays nothing on restart —
  // argon2 is deliberately slow. The authoritative check is inside the
  // transaction below; this one only skips the work in the common case.
  const [seeded] = await db
    .select({ userId: userGroups.userId })
    .from(userGroups)
    .where(eq(userGroups.groupId, ADMIN_GROUP_ID))
    .limit(1);
  if (seeded) return null;

  const password = randomBytes(PASSWORD_BYTES).toString('base64url');
  // Hash before opening the transaction rather than holding SQLite's single
  // writer lock for the duration.
  const passwordHash = await hash(password);

  return db.transaction(async (tx) => {
    const [existingAdmin] = await tx
      .select({ userId: userGroups.userId })
      .from(userGroups)
      .where(eq(userGroups.groupId, ADMIN_GROUP_ID))
      .limit(1);
    if (existingAdmin) return null;

    const taken = new Set(
      (
        await tx
          .select({ username: users.username })
          .from(users)
          .where(like(users.username, `${SEEDED_ADMIN_USERNAME}%`))
      ).map((row) => row.username),
    );
    const username = firstFreeAdminUsername(taken);

    const [inserted] = await tx
      .insert(users)
      .values({ username, passwordHash })
      .returning({ id: users.id });
    if (!inserted) throw new Error('admin seed insert returned no row');

    await tx.insert(userGroups).values({ userId: inserted.id, groupId: ADMIN_GROUP_ID });

    return { username, password };
  });
}

/**
 * Prints the one-time administrator credentials to stdout. Deliberately
 * `console.log` rather than the app logger: pino ships records over OTLP when
 * telemetry is enabled, and the password must not leave the host.
 */
function announce(credentials: SeededAdminCredentials): void {
  const line = '='.repeat(64);
  console.log(
    [
      '',
      line,
      '  MarketTrader — administrator account created',
      '',
      `    username: ${credentials.username}`,
      `    password: ${credentials.password}`,
      '',
      credentials.username === SEEDED_ADMIN_USERNAME
        ? '  This is shown once and never again. Sign in and change it now.'
        : `  "${SEEDED_ADMIN_USERNAME}" was already taken by a non-admin account, so a\n  suffixed name was used. This is shown once and never again.`,
      line,
      '',
    ].join('\n'),
  );
}

/**
 * Boot-time hook: seeds the first administrator on a fresh database and prints
 * the generated credentials once. No-op under `NODE_ENV=test`, for in-memory
 * databases, and on every boot after an admin already exists.
 *
 * Called from `src/index.ts` immediately after migrations.
 */
export async function bootstrapAdmin(db: Db): Promise<void> {
  if (!shouldSeedAdminOnBoot(env.NODE_ENV, env.DATABASE_URL)) return;
  const credentials = await ensureSeededAdmin(db);
  if (credentials) announce(credentials);
}
