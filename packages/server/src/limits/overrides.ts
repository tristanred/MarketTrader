import { and, eq, inArray } from 'drizzle-orm';
import type { AdminLimitOverrideEntry, LimitKey } from '@markettrader/shared';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import { recordAdminAction } from '../services/admin-audit.js';
import { isLimitKey } from './catalogue.js';
import { toIsoUtc } from './account.js';

/** One stored override with its provenance. */
export interface LimitOverride {
  value: number;
  note: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

// The resolver reads overrides on every limited request; the cache makes that a
// map lookup. Bounded so a flood of distinct users cannot grow it without limit.
const CACHE_MAX_USERS = 5_000;

/**
 * Reads and writes per-user limit overrides. Writes are audited in the same
 * transaction and invalidate the in-process cache; safe because the app runs
 * as a single process (ADR-018).
 */
export class LimitOverridesService {
  private readonly cache = new Map<string, Map<LimitKey, number>>();

  constructor(private readonly db: Db) {}

  /** Every override for `userId`, as values only. Cached, least-recently-used eviction. */
  async forUser(userId: string): Promise<Map<LimitKey, number>> {
    const hit = this.cache.get(userId);
    if (hit) {
      this.cache.delete(userId);
      this.cache.set(userId, hit);
      return hit;
    }
    const t = schema.userLimitOverrides;
    const rows = await this.db
      .select({ limitKey: t.limitKey, value: t.value })
      .from(t)
      .where(eq(t.userId, userId));
    const values = new Map<LimitKey, number>();
    for (const row of rows) if (isLimitKey(row.limitKey)) values.set(row.limitKey, row.value);
    this.cache.set(userId, values);
    if (this.cache.size > CACHE_MAX_USERS) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    return values;
  }

  async get(userId: string, key: LimitKey): Promise<number | undefined> {
    return (await this.forUser(userId)).get(key);
  }

  /** Overrides for one user with note and author, uncached (admin views only). */
  async listForUser(userId: string): Promise<Map<LimitKey, LimitOverride>> {
    const t = schema.userLimitOverrides;
    const rows = await this.db.select().from(t).where(eq(t.userId, userId));
    const out = new Map<LimitKey, LimitOverride>();
    for (const row of rows) {
      if (!isLimitKey(row.limitKey)) continue;
      out.set(row.limitKey, {
        value: row.value,
        note: row.note,
        updatedBy: row.updatedBy,
        updatedAt: toIsoUtc(row.updatedAt),
      });
    }
    return out;
  }

  /** Creates or replaces one override and audits `user.limit.override`. `value` must already be validated. */
  async set(
    adminId: string,
    userId: string,
    key: LimitKey,
    value: number,
    note: string | null,
  ): Promise<void> {
    const t = schema.userLimitOverrides;
    const now = new Date().toISOString();
    await this.db.transaction(async (tx) => {
      const [before] = await tx
        .select({ value: t.value, note: t.note })
        .from(t)
        .where(and(eq(t.userId, userId), eq(t.limitKey, key)))
        .limit(1);
      await tx
        .insert(t)
        .values({ userId, limitKey: key, value, note, updatedBy: adminId, updatedAt: now })
        .onConflictDoUpdate({
          target: [t.userId, t.limitKey],
          set: { value, note, updatedBy: adminId, updatedAt: now },
        });
      await recordAdminAction(tx, {
        adminUserId: adminId,
        action: 'user.limit.override',
        targetType: 'user',
        targetId: userId,
        before: before ? { key, value: before.value, note: before.note } : null,
        after: { key, value, note },
      });
    });
    this.cache.delete(userId);
  }

  /** Removes one override. Returns false (and audits nothing) when there was none. */
  async clear(adminId: string, userId: string, key: LimitKey): Promise<boolean> {
    const t = schema.userLimitOverrides;
    const removed = await this.db.transaction(async (tx) => {
      const rows = await tx
        .delete(t)
        .where(and(eq(t.userId, userId), eq(t.limitKey, key)))
        .returning({ value: t.value, note: t.note });
      const row = rows[0];
      if (!row) return false;
      await recordAdminAction(tx, {
        adminUserId: adminId,
        action: 'user.limit.reset',
        targetType: 'user',
        targetId: userId,
        before: { key, value: row.value, note: row.note },
        after: null,
      });
      return true;
    });
    this.cache.delete(userId);
    return removed;
  }

  /** Every active override with the target's and the author's usernames, newest first. */
  async listAll(): Promise<AdminLimitOverrideEntry[]> {
    const t = schema.userLimitOverrides;
    const rows = await this.db
      .select({
        userId: t.userId,
        username: schema.users.username,
        limitKey: t.limitKey,
        value: t.value,
        note: t.note,
        updatedBy: t.updatedBy,
        updatedAt: t.updatedAt,
      })
      .from(t)
      .innerJoin(schema.users, eq(schema.users.id, t.userId));

    const authorIds = [
      ...new Set(rows.map((r) => r.updatedBy).filter((id): id is string => id !== null)),
    ];
    const authors =
      authorIds.length === 0
        ? []
        : await this.db
            .select({ id: schema.users.id, username: schema.users.username })
            .from(schema.users)
            .where(inArray(schema.users.id, authorIds));
    const authorName = new Map(authors.map((a) => [a.id, a.username]));

    const entries: AdminLimitOverrideEntry[] = [];
    for (const row of rows) {
      if (!isLimitKey(row.limitKey)) continue;
      entries.push({
        userId: row.userId,
        username: row.username,
        key: row.limitKey,
        value: row.value,
        note: row.note,
        updatedBy: row.updatedBy,
        updatedByUsername: row.updatedBy ? (authorName.get(row.updatedBy) ?? null) : null,
        updatedAt: toIsoUtc(row.updatedAt),
      });
    }
    return entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}
