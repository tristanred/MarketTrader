import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../helpers/app.js';
import { schema } from '../../src/db/index.js';
import { UsageTracker, hourStartOf } from '../../src/limits/usage-tracker.js';
import {
  deleteUsageForUser,
  flushUsage,
  pruneUsage,
  topConsumers,
  userDenials,
  userRequestVolume,
  windowStartIso,
} from '../../src/limits/usage-store.js';

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

// 2026-10-14 13:25 UTC → hour bucket 13:00.
const T0 = Date.UTC(2026, 9, 14, 13, 25, 0);
const HOUR = 3_600_000;

describe('usage-store', () => {
  let db: TestDb;
  let clock: number;
  let tracker: UsageTracker;

  beforeEach(async () => {
    db = await createTestDb();
    // createTestDb shares one in-memory DB per file; start each test empty.
    await db.delete(schema.apiUsageHourly);
    await db.delete(schema.limitDenialsHourly);
    clock = T0;
    tracker = new UsageTracker({ now: () => clock });
  });

  it('truncates to the hour and computes window starts', () => {
    expect(hourStartOf(T0)).toBe('2026-10-14T13:00:00.000Z');
    expect(windowStartIso(new Date(T0), 24)).toBe('2026-10-13T13:00:00.000Z');
  });

  it('adds counts across flushes instead of overwriting them', async () => {
    const u = { type: 'user' as const, id: 'u1' };
    tracker.recordRequest(u, 'GET /games');
    tracker.recordRequest(u, 'GET /games');
    await flushUsage(db, tracker.swap());
    tracker.recordRequest(u, 'GET /games');
    await flushUsage(db, tracker.swap());

    const rows = await db.select().from(schema.apiUsageHourly);
    expect(rows).toEqual([
      { subjectType: 'user', subjectId: 'u1', route: 'GET /games', hourStart: '2026-10-14T13:00:00.000Z', count: 3 },
    ]);
  });

  it('keeps first_at and advances last_at for denials', async () => {
    const u = { type: 'user' as const, id: 'u1' };
    tracker.recordDenial(u, 'gamesCreated');
    await flushUsage(db, tracker.swap());
    clock = T0 + 10 * 60_000;
    tracker.recordDenial(u, 'gamesCreated');
    await flushUsage(db, tracker.swap());

    const [row] = await db.select().from(schema.limitDenialsHourly);
    expect(row).toMatchObject({
      limitKey: 'gamesCreated',
      count: 2,
      firstAt: new Date(T0).toISOString(),
      lastAt: new Date(T0 + 10 * 60_000).toISOString(),
    });
  });

  it('flushing an empty snapshot is a no-op', async () => {
    await flushUsage(db, tracker.swap());
    expect(await db.select().from(schema.apiUsageHourly)).toHaveLength(0);
  });

  it('prunes rows strictly older than the cutoff', async () => {
    const u = { type: 'user' as const, id: 'u1' };
    tracker.recordRequest(u, 'GET /games');
    tracker.recordDenial(u, 'trades');
    clock = T0 + 2 * HOUR;
    tracker.recordRequest(u, 'GET /games');
    await flushUsage(db, tracker.swap());

    await pruneUsage(db, '2026-10-14T14:00:00.000Z');
    const rows = await db.select().from(schema.apiUsageHourly);
    expect(rows.map((r) => r.hourStart)).toEqual(['2026-10-14T15:00:00.000Z']);
    expect(await db.select().from(schema.limitDenialsHourly)).toHaveLength(0);
  });

  it('ranks top consumers from flushed rows plus the unflushed buffer', async () => {
    const heavy = { type: 'user' as const, id: 'heavy' };
    const light = { type: 'user' as const, id: 'light' };
    const anon = { type: 'ip' as const, id: '198.51.100.9' };
    for (let i = 0; i < 5; i++) tracker.recordRequest(heavy, 'POST /games/:id/trades');
    tracker.recordRequest(heavy, 'GET /games');
    tracker.recordRequest(light, 'GET /games');
    await flushUsage(db, tracker.swap());
    // Not flushed yet: must still count.
    for (let i = 0; i < 3; i++) tracker.recordRequest(anon, 'GET /stocks/search');

    const rows = await topConsumers(db, tracker, {
      sinceIso: windowStartIso(new Date(clock), 24),
      metric: 'requests',
      limit: 10,
    });
    expect(rows).toEqual([
      { subjectType: 'user', subjectId: 'heavy', count: 6, top: 'POST /games/:id/trades' },
      { subjectType: 'ip', subjectId: '198.51.100.9', count: 3, top: 'GET /stocks/search' },
      { subjectType: 'user', subjectId: 'light', count: 1, top: 'GET /games' },
    ]);
  });

  it('excludes rows before the window and honours the limit', async () => {
    const old = { type: 'user' as const, id: 'old' };
    const now = { type: 'user' as const, id: 'now' };
    tracker.recordRequest(old, 'GET /games');
    await flushUsage(db, tracker.swap());
    clock = T0 + 30 * HOUR;
    tracker.recordRequest(now, 'GET /games');
    tracker.recordRequest(now, 'GET /games');

    const rows = await topConsumers(db, tracker, {
      sinceIso: windowStartIso(new Date(clock), 24),
      metric: 'requests',
      limit: 1,
    });
    expect(rows.map((r) => r.subjectId)).toEqual(['now']);
  });

  it('ranks denials by limit key', async () => {
    const u = { type: 'user' as const, id: 'u1' };
    tracker.recordDenial(u, 'trades');
    tracker.recordDenial(u, 'trades');
    tracker.recordDenial(u, 'gamesCreated');
    await flushUsage(db, tracker.swap());

    const rows = await topConsumers(db, tracker, {
      sinceIso: windowStartIso(new Date(clock), 24),
      metric: 'denials',
      limit: 10,
    });
    expect(rows).toEqual([{ subjectType: 'user', subjectId: 'u1', count: 3, top: 'trades' }]);
  });

  it('reports one user’s request volume by route and denials, merged with the buffer', async () => {
    const u = { type: 'user' as const, id: 'u1' };
    const other = { type: 'user' as const, id: 'u2' };
    tracker.recordRequest(u, 'GET /games');
    tracker.recordRequest(u, 'GET /games');
    tracker.recordRequest(other, 'GET /games');
    tracker.recordDenial(u, 'trades');
    await flushUsage(db, tracker.swap());
    tracker.recordRequest(u, 'POST /games');
    tracker.recordDenial(u, 'trades');

    const since = windowStartIso(new Date(clock), 24 * 7);
    expect(await userRequestVolume(db, tracker, 'u1', since, 10)).toEqual([
      { route: 'GET /games', count: 2 },
      { route: 'POST /games', count: 1 },
    ]);
    const denials = await userDenials(db, tracker, 'u1', since);
    expect(denials).toEqual([{ limitKey: 'trades', count: 2, lastAt: new Date(T0).toISOString() }]);
  });

  it('deletes only the given user’s rows', async () => {
    tracker.recordRequest({ type: 'user', id: 'gone' }, 'GET /games');
    tracker.recordDenial({ type: 'user', id: 'gone' }, 'trades');
    tracker.recordRequest({ type: 'user', id: 'kept' }, 'GET /games');
    tracker.recordRequest({ type: 'ip', id: 'gone' }, 'GET /stocks/search');
    await flushUsage(db, tracker.swap());

    await deleteUsageForUser(db, 'gone');
    const rows = await db.select().from(schema.apiUsageHourly);
    expect(rows.map((r) => `${r.subjectType}:${r.subjectId}`).sort()).toEqual(['ip:gone', 'user:kept']);
    expect(await db.select().from(schema.limitDenialsHourly)).toHaveLength(0);
  });
});
