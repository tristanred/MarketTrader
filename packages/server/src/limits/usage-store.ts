import { and, desc, eq, gte, inArray, lt, max, sql, sum } from 'drizzle-orm';
import type { AdminDenialSummary, AdminRouteVolume } from '@markettrader/shared';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import { hourStartOf, type UsageSnapshot, type UsageTracker } from './usage-tracker.js';

const HOUR_MS = 3_600_000;
// Keeps each multi-row upsert well under SQLite's bound-parameter ceiling (7 columns × 200 rows).
const FLUSH_CHUNK = 200;
// Subjects read from the database before the buffer merge. Bounds the in-memory
// ranking; a subject outside it can only surface through its unflushed counts.
const STORED_SUBJECT_CAP = 1000;

/** Start of the hour bucket `hours` before `now` — the inclusive lower bound of a window. */
export function windowStartIso(now: Date, hours: number): string {
  return hourStartOf(now.getTime() - hours * HOUR_MS);
}

function* chunks<T>(rows: readonly T[], size: number): Generator<T[]> {
  for (let i = 0; i < rows.length; i += size) yield rows.slice(i, i + size);
}

/**
 * Adds a tracker snapshot into the hourly tables in one transaction. Counts are
 * summed into existing rows (`count + excluded.count`), so flushing the same hour
 * twice accumulates rather than overwrites. `first_at` keeps the earliest value
 * because snapshots are flushed in order.
 */
export async function flushUsage(db: Db, snapshot: UsageSnapshot): Promise<void> {
  if (snapshot.requests.length === 0 && snapshot.denials.length === 0) return;
  const { apiUsageHourly: usage, limitDenialsHourly: denials } = schema;

  await db.transaction(async (tx) => {
    for (const chunk of chunks(snapshot.requests, FLUSH_CHUNK)) {
      await tx
        .insert(usage)
        .values(chunk.map((r) => ({
          subjectType: r.subjectType,
          subjectId: r.subjectId,
          route: r.route,
          hourStart: r.hourStart,
          count: r.count,
        })))
        .onConflictDoUpdate({
          target: [usage.subjectType, usage.subjectId, usage.route, usage.hourStart],
          set: { count: sql`${usage.count} + excluded.count` },
        });
    }
    for (const chunk of chunks(snapshot.denials, FLUSH_CHUNK)) {
      await tx
        .insert(denials)
        .values(chunk.map((d) => ({
          subjectType: d.subjectType,
          subjectId: d.subjectId,
          limitKey: d.limitKey,
          hourStart: d.hourStart,
          count: d.count,
          firstAt: d.firstAt,
          lastAt: d.lastAt,
        })))
        .onConflictDoUpdate({
          target: [denials.subjectType, denials.subjectId, denials.limitKey, denials.hourStart],
          set: {
            count: sql`${denials.count} + excluded.count`,
            lastAt: sql`excluded.last_at`,
          },
        });
    }
  });
}

/** Deletes hourly rows whose bucket starts before `olderThanIso`. */
export async function pruneUsage(db: Db, olderThanIso: string): Promise<void> {
  await db.delete(schema.apiUsageHourly).where(lt(schema.apiUsageHourly.hourStart, olderThanIso));
  await db.delete(schema.limitDenialsHourly).where(lt(schema.limitDenialsHourly.hourStart, olderThanIso));
}

/**
 * Removes a user's persisted usage history. Call inside the user-delete
 * transaction; the buffered counts are dropped separately with `UsageTracker.forgetUser`.
 * A flush that swapped the buffer before `forgetUser` but commits after the delete can
 * re-insert rows for the gone id; they age out with the retention prune.
 */
export async function deleteUsageForUser(tx: Pick<Db, 'delete'>, userId: string): Promise<void> {
  await tx
    .delete(schema.apiUsageHourly)
    .where(and(eq(schema.apiUsageHourly.subjectType, 'user'), eq(schema.apiUsageHourly.subjectId, userId)));
  await tx
    .delete(schema.limitDenialsHourly)
    .where(and(eq(schema.limitDenialsHourly.subjectType, 'user'), eq(schema.limitDenialsHourly.subjectId, userId)));
}

/** One subject's total in a window and the route (or limit key) contributing most. */
export interface TopConsumerRow {
  subjectType: 'user' | 'ip';
  subjectId: string;
  count: number;
  top: string | null;
}

interface Contribution {
  subjectType: 'user' | 'ip';
  subjectId: string;
  key: string;
  count: number;
}

/** Unflushed rows at or after `sinceIso`, in the same shape as the grouped DB rows. */
function bufferedContributions(
  tracker: UsageTracker,
  metric: 'requests' | 'denials',
  sinceIso: string,
): Contribution[] {
  const view = tracker.snapshotView();
  const rows = metric === 'requests'
    ? view.requests.map((r) => ({ subjectType: r.subjectType, subjectId: r.subjectId, key: r.route, hourStart: r.hourStart, count: r.count }))
    : view.denials.map((d) => ({ subjectType: d.subjectType, subjectId: d.subjectId, key: d.limitKey, hourStart: d.hourStart, count: d.count }));
  return rows
    .filter((r) => r.hourStart >= sinceIso)
    .map(({ subjectType, subjectId, key, count }) => ({ subjectType, subjectId, key, count }));
}

/**
 * Per-key totals for the {@link STORED_SUBJECT_CAP} heaviest stored subjects.
 * Ranked by subject total in SQL first, so the cap never splits one subject's
 * routes; the per-key query then only reads rows of the subjects that survived.
 */
async function storedContributions(
  db: Db,
  metric: 'requests' | 'denials',
  sinceIso: string,
): Promise<Contribution[]> {
  if (metric === 'requests') {
    const t = schema.apiUsageHourly;
    const total = sum(t.count);
    const heaviest = await db
      .select({ subjectType: t.subjectType, subjectId: t.subjectId })
      .from(t)
      .where(gte(t.hourStart, sinceIso))
      .groupBy(t.subjectType, t.subjectId)
      .orderBy(desc(total))
      .limit(STORED_SUBJECT_CAP);
    if (heaviest.length === 0) return [];
    const keep = new Set(heaviest.map((s) => `${s.subjectType}:${s.subjectId}`));
    const rows = await db
      .select({ subjectType: t.subjectType, subjectId: t.subjectId, key: t.route, total: sum(t.count) })
      .from(t)
      .where(and(gte(t.hourStart, sinceIso), inArray(t.subjectId, heaviest.map((s) => s.subjectId))))
      .groupBy(t.subjectType, t.subjectId, t.route);
    return rows
      .filter((r) => keep.has(`${r.subjectType}:${r.subjectId}`))
      .map((r) => ({ subjectType: r.subjectType, subjectId: r.subjectId, key: r.key, count: Number(r.total ?? 0) }));
  }

  const t = schema.limitDenialsHourly;
  const total = sum(t.count);
  const heaviest = await db
    .select({ subjectType: t.subjectType, subjectId: t.subjectId })
    .from(t)
    .where(gte(t.hourStart, sinceIso))
    .groupBy(t.subjectType, t.subjectId)
    .orderBy(desc(total))
    .limit(STORED_SUBJECT_CAP);
  if (heaviest.length === 0) return [];
  const keep = new Set(heaviest.map((s) => `${s.subjectType}:${s.subjectId}`));
  const rows = await db
    .select({ subjectType: t.subjectType, subjectId: t.subjectId, key: t.limitKey, total: sum(t.count) })
    .from(t)
    .where(and(gte(t.hourStart, sinceIso), inArray(t.subjectId, heaviest.map((s) => s.subjectId))))
    .groupBy(t.subjectType, t.subjectId, t.limitKey);
  return rows
    .filter((r) => keep.has(`${r.subjectType}:${r.subjectId}`))
    .map((r) => ({ subjectType: r.subjectType, subjectId: r.subjectId, key: r.key, count: Number(r.total ?? 0) }));
}

/**
 * Subjects ranked by requests or denials since `sinceIso`, merging the tracker's
 * unflushed buffer so the panel is current to the request, not the last flush.
 * The database ranks and caps subjects; the buffer merge and final ordering run in memory.
 * A `user` subject may name a deleted account (see {@link deleteUsageForUser}); callers resolve ids leniently.
 */
export async function topConsumers(
  db: Db,
  tracker: UsageTracker,
  opts: { sinceIso: string; metric: 'requests' | 'denials'; limit: number },
): Promise<TopConsumerRow[]> {
  const stored = await storedContributions(db, opts.metric, opts.sinceIso);

  const bySubject = new Map<string, { subjectType: 'user' | 'ip'; subjectId: string; perKey: Map<string, number> }>();
  for (const c of [...stored, ...bufferedContributions(tracker, opts.metric, opts.sinceIso)]) {
    const id = `${c.subjectType}:${c.subjectId}`;
    let entry = bySubject.get(id);
    if (!entry) {
      entry = { subjectType: c.subjectType, subjectId: c.subjectId, perKey: new Map() };
      bySubject.set(id, entry);
    }
    entry.perKey.set(c.key, (entry.perKey.get(c.key) ?? 0) + c.count);
  }

  const ranked: TopConsumerRow[] = [...bySubject.values()].map((e) => {
    let total = 0;
    let top: string | null = null;
    let topCount = -1;
    for (const [key, n] of e.perKey) {
      total += n;
      if (n > topCount) {
        top = key;
        topCount = n;
      }
    }
    return { subjectType: e.subjectType, subjectId: e.subjectId, count: total, top };
  });
  ranked.sort((a, b) => b.count - a.count || a.subjectId.localeCompare(b.subjectId));
  return ranked.slice(0, opts.limit);
}

/** A user's request count per route since `sinceIso`, highest first, flushed + buffered. */
export async function userRequestVolume(
  db: Db,
  tracker: UsageTracker,
  userId: string,
  sinceIso: string,
  limit: number,
): Promise<AdminRouteVolume[]> {
  const t = schema.apiUsageHourly;
  const rows = await db
    .select({ route: t.route, total: sum(t.count) })
    .from(t)
    .where(and(eq(t.subjectType, 'user'), eq(t.subjectId, userId), gte(t.hourStart, sinceIso)))
    .groupBy(t.route);

  const byRoute = new Map(rows.map((r) => [r.route, Number(r.total ?? 0)]));
  for (const c of bufferedContributions(tracker, 'requests', sinceIso)) {
    if (c.subjectType === 'user' && c.subjectId === userId) {
      byRoute.set(c.key, (byRoute.get(c.key) ?? 0) + c.count);
    }
  }
  return [...byRoute]
    .map(([route, count]) => ({ route, count }))
    .sort((a, b) => b.count - a.count || a.route.localeCompare(b.route))
    .slice(0, limit);
}

/** A user's denials per limit key since `sinceIso`, with the latest denial time. */
export async function userDenials(
  db: Db,
  tracker: UsageTracker,
  userId: string,
  sinceIso: string,
): Promise<AdminDenialSummary[]> {
  const t = schema.limitDenialsHourly;
  const rows = await db
    .select({ limitKey: t.limitKey, total: sum(t.count), lastAt: max(t.lastAt) })
    .from(t)
    .where(and(eq(t.subjectType, 'user'), eq(t.subjectId, userId), gte(t.hourStart, sinceIso)))
    .groupBy(t.limitKey);

  const byKey = new Map(rows.map((r) => [r.limitKey, { count: Number(r.total ?? 0), lastAt: r.lastAt ?? '' }]));
  for (const d of tracker.snapshotView().denials) {
    if (d.subjectType !== 'user' || d.subjectId !== userId || d.hourStart < sinceIso) continue;
    const prev = byKey.get(d.limitKey) ?? { count: 0, lastAt: '' };
    byKey.set(d.limitKey, { count: prev.count + d.count, lastAt: d.lastAt > prev.lastAt ? d.lastAt : prev.lastAt });
  }
  return [...byKey]
    .map(([limitKey, v]) => ({ limitKey, count: v.count, lastAt: v.lastAt }))
    .sort((a, b) => b.count - a.count || a.limitKey.localeCompare(b.limitKey));
}
