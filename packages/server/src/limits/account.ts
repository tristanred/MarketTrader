import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import { ADMIN_GROUP_ID } from '../constants/groups.js';

/** Who an authenticated request belongs to, as far as limits care. */
export interface RequestAccount {
  id: string;
  /** ISO-8601 UTC. */
  createdAt: string;
  isAdmin: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `verifyAccessToken`; undefined on unauthenticated requests. */
    account?: RequestAccount;
  }
}

const HAS_ZONE = /(?:[zZ]|[+-]\d\d(?::?\d\d)?)$/;

/**
 * Normalises a stored timestamp to ISO-8601 UTC. SQLite's `datetime('now')` and
 * postgres-js's zone-less timestamps both come back as `YYYY-MM-DD HH:MM:SS[.f]`
 * in UTC with no zone, which `Date.parse` would read as local time.
 */
export function toIsoUtc(value: string): string {
  const parsed = new Date(HAS_ZONE.test(value) ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

/**
 * The live account row plus admin membership in one query: the left join finds
 * the admin `user_groups` row if there is one. Undefined when the user is gone.
 */
export async function loadAccount(
  db: Db,
  userId: string,
): Promise<(RequestAccount & { disabled: boolean }) | undefined> {
  const { users, userGroups } = schema;
  const [row] = await db
    .select({
      id: users.id,
      disabled: users.disabled,
      createdAt: users.createdAt,
      adminGroupId: userGroups.groupId,
    })
    .from(users)
    .leftJoin(userGroups, and(eq(userGroups.userId, users.id), eq(userGroups.groupId, ADMIN_GROUP_ID)))
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return undefined;
  return {
    id: row.id,
    disabled: row.disabled,
    createdAt: toIsoUtc(row.createdAt),
    isAdmin: row.adminGroupId !== null,
  };
}
