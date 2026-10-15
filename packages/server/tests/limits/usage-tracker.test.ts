import { describe, it, expect } from 'vitest';
import { OVERFLOW_SUBJECT_ID, UsageTracker, hourStartOf } from '../../src/limits/usage-tracker.js';

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 9, 14, 13, 20); // 13:20Z

function clock(start = T0) {
  let t = start;
  return { now: () => t, set: (v: number) => { t = v; } };
}

describe('hourStartOf', () => {
  it('truncates to the UTC hour', () => {
    expect(hourStartOf(T0)).toBe('2026-10-14T13:00:00.000Z');
  });
});

describe('UsageTracker', () => {
  it('aggregates requests per subject, route and hour', () => {
    const c = clock();
    const t = new UsageTracker({ now: c.now });
    t.recordRequest({ type: 'user', id: 'u1' }, 'GET /watchlists');
    t.recordRequest({ type: 'user', id: 'u1' }, 'GET /watchlists');
    t.recordRequest({ type: 'user', id: 'u1' }, 'POST /games');
    t.recordRequest({ type: 'ip', id: '10.0.0.1' }, 'GET /watchlists');
    c.set(T0 + HOUR);
    t.recordRequest({ type: 'user', id: 'u1' }, 'GET /watchlists');

    const rows = t.snapshotView().requests;
    expect(rows).toHaveLength(4);
    expect(rows).toContainEqual({
      subjectType: 'user', subjectId: 'u1', route: 'GET /watchlists',
      hourStart: '2026-10-14T13:00:00.000Z', count: 2,
    });
    expect(rows).toContainEqual({
      subjectType: 'user', subjectId: 'u1', route: 'GET /watchlists',
      hourStart: '2026-10-14T14:00:00.000Z', count: 1,
    });
  });

  it('aggregates denials with first and last timestamps', () => {
    const c = clock();
    const t = new UsageTracker({ now: c.now });
    t.recordDenial({ type: 'user', id: 'u1' }, 'trades');
    c.set(T0 + 60_000);
    t.recordDenial({ type: 'user', id: 'u1' }, 'trades');
    expect(t.snapshotView().denials).toEqual([
      {
        subjectType: 'user', subjectId: 'u1', limitKey: 'trades',
        hourStart: '2026-10-14T13:00:00.000Z', count: 2,
        firstAt: new Date(T0).toISOString(), lastAt: new Date(T0 + 60_000).toISOString(),
      },
    ]);
  });

  it('diverts new keys to an overflow subject once the bound is reached', () => {
    const t = new UsageTracker({ now: clock().now, maxRequestKeys: 2, maxDenialKeys: 1 });
    t.recordRequest({ type: 'ip', id: 'a' }, 'GET /x');
    t.recordRequest({ type: 'ip', id: 'b' }, 'GET /x');
    t.recordRequest({ type: 'ip', id: 'c' }, 'GET /x');
    t.recordRequest({ type: 'ip', id: 'd' }, 'GET /x');
    t.recordRequest({ type: 'ip', id: 'a' }, 'GET /x'); // existing key still counts normally
    t.recordDenial({ type: 'ip', id: 'a' }, 'k');
    t.recordDenial({ type: 'ip', id: 'b' }, 'k');

    const snap = t.snapshotView();
    expect(snap.requests.find((r) => r.subjectId === 'a')?.count).toBe(2);
    expect(snap.requests.find((r) => r.subjectId === OVERFLOW_SUBJECT_ID)?.count).toBe(2);
    expect(snap.requests.some((r) => r.subjectId === 'c')).toBe(false);
    expect(snap.overflow).toEqual({ requests: 2, denials: 1 });
  });

  it('swap hands over the buffers and starts empty', () => {
    const t = new UsageTracker({ now: clock().now });
    t.recordRequest({ type: 'user', id: 'u1' }, 'GET /games');
    t.recordDenial({ type: 'user', id: 'u1' }, 'trades');
    const snap = t.swap();
    expect(snap.requests).toHaveLength(1);
    expect(snap.denials).toHaveLength(1);
    expect(t.snapshotView()).toEqual({ requests: [], denials: [], overflow: { requests: 0, denials: 0 } });
  });

  it('snapshotView does not drain or alias the buffers', () => {
    const t = new UsageTracker({ now: clock().now });
    t.recordRequest({ type: 'user', id: 'u1' }, 'GET /games');
    const view = t.snapshotView();
    view.requests[0]!.count = 99;
    expect(t.snapshotView().requests[0]!.count).toBe(1);
  });

  it('forgetUser drops only that user’s buffered rows', () => {
    const t = new UsageTracker({ now: clock().now });
    t.recordRequest({ type: 'user', id: 'gone' }, 'GET /games');
    t.recordDenial({ type: 'user', id: 'gone' }, 'trades');
    t.recordRequest({ type: 'ip', id: 'gone' }, 'GET /games');
    t.recordRequest({ type: 'user', id: 'kept' }, 'GET /games');
    t.forgetUser('gone');
    const view = t.snapshotView();
    expect(view.requests.map((r) => `${r.subjectType}:${r.subjectId}`).sort()).toEqual(['ip:gone', 'user:kept']);
    expect(view.denials).toEqual([]);
  });

  it('counts a user’s requests over a sliding minute', () => {
    const c = clock();
    const t = new UsageTracker({ now: c.now });
    expect(t.hitMinute('u1')).toBe(1);
    expect(t.hitMinute('u1')).toBe(2);
    expect(t.peekMinute('u1')).toBe(2);
    expect(t.peekMinute('u2')).toBe(0);
    c.set(T0 + 120_000);
    expect(t.peekMinute('u1')).toBe(0);
  });
});
