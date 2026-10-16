import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb } from '../helpers/app.js';
import { schema } from '../../src/db/index.js';
import { RuntimeConfig } from '../../src/config/runtime-config.js';
import { UsageTracker } from '../../src/limits/usage-tracker.js';
import { flushUsage } from '../../src/limits/usage-store.js';
import { runUsageRollupTick, startUsageRollupWorker } from '../../src/workers/usage-rollup.js';

const T0 = Date.UTC(2026, 9, 14, 13, 25, 0);
const DAY = 86_400_000;

describe('usage-rollup worker', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    db = await createTestDb();
    await db.delete(schema.apiUsageHourly);
    await db.delete(schema.limitDenialsHourly);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('flushes the buffer and prunes rows past retention in one tick', async () => {
    let clock = T0 - 10 * DAY;
    const tracker = new UsageTracker({ now: () => clock });
    tracker.recordRequest({ type: 'user', id: 'u1' }, 'GET /games');
    await flushUsage(db, tracker.swap());

    clock = T0;
    tracker.recordRequest({ type: 'user', id: 'u1' }, 'POST /games');
    tracker.recordDenial({ type: 'user', id: 'u1' }, 'gamesCreated');
    await runUsageRollupTick({
      db,
      tracker,
      config: RuntimeConfig.fromEnvironment({ USAGE_RETENTION_DAYS: 7 }),
      now: () => new Date(T0),
    });

    const usage = await db.select().from(schema.apiUsageHourly);
    expect(usage.map((r) => r.route)).toEqual(['POST /games']);
    expect(await db.select().from(schema.limitDenialsHourly)).toHaveLength(1);
    expect(tracker.snapshotView().requests).toHaveLength(0);
  });

  it('warns when the tracker overflowed', async () => {
    const tracker = new UsageTracker({ maxRequestKeys: 1, now: () => T0 });
    tracker.recordRequest({ type: 'user', id: 'a' }, 'GET /games');
    tracker.recordRequest({ type: 'user', id: 'b' }, 'GET /games');
    const warn = vi.fn();
    await runUsageRollupTick({
      db,
      tracker,
      config: RuntimeConfig.fromEnvironment(),
      logger: { warn } as unknown as import('fastify').FastifyBaseLogger,
      now: () => new Date(T0),
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('runs on its interval and stops cleanly', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const tracker = new UsageTracker();
    const worker = startUsageRollupWorker({
      db,
      tracker,
      config: RuntimeConfig.fromEnvironment(),
      intervalMs: 1000,
    });
    tracker.recordRequest({ type: 'ip', id: '198.51.100.1' }, 'GET /stocks/search');

    await vi.advanceTimersByTimeAsync(1000);
    // The tick's DB writes resolve on later microtasks; drain them before reading.
    await vi.advanceTimersByTimeAsync(0);
    expect(await db.select().from(schema.apiUsageHourly)).toHaveLength(1);

    await worker.stop();
  });
});
