import { describe, it, expect, vi, afterEach } from 'vitest';
import { createTestDb } from '../helpers/app.js';
import { schema } from '../../src/db/index.js';
import { MockProvider } from '../../src/providers/mock.js';
import { runDiscoverTick, startDiscoverWorker } from '../../src/workers/discover.js';

// Tuesday 2026-05-19 16:05 ET — after the close, so movers are captured too.
const AFTER_CLOSE = new Date(Date.UTC(2026, 4, 19, 20, 5, 0));

async function seedActiveGame(db: Awaited<ReturnType<typeof createTestDb>>, tag: string) {
  const [u] = await db
    .insert(schema.users)
    .values({ username: `dw_${tag}`, passwordHash: 'x' })
    .returning({ id: schema.users.id });
  const [g] = await db
    .insert(schema.games)
    .values({
      name: tag,
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2027-01-01T00:00:00.000Z',
      startingBalance: 10000,
      status: 'active',
      createdBy: u!.id,
    })
    .returning({ id: schema.games.id });
  return g!.id;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('runDiscoverTick', () => {
  it('produces movers and picks in one tick', async () => {
    const db = await createTestDb();
    await seedActiveGame(db, 'tick');
    await runDiscoverTick({ db, provider: new MockProvider(), now: () => AFTER_CLOSE });
    expect(await db.select().from(schema.discoverMarketMovers)).toHaveLength(4);
    expect((await db.select().from(schema.gameDiscoverPicks)).length).toBeGreaterThanOrEqual(1);
  });
});

describe('startDiscoverWorker', () => {
  it('ticks immediately at start and then on its interval', async () => {
    vi.useFakeTimers();
    const db = await createTestDb();
    // createTestDb shares one in-memory DB per file; drop the previous test's rows.
    await db.delete(schema.discoverMarketMovers);
    const provider = new MockProvider();
    const spy = vi.spyOn(provider, 'getMarketMovers');
    const worker = startDiscoverWorker({
      db,
      provider,
      now: () => AFTER_CLOSE,
      intervalMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(10);
    const afterFirst = spy.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);

    await db.delete(schema.discoverMarketMovers);
    await vi.advanceTimersByTimeAsync(1000);
    expect(spy.mock.calls.length).toBeGreaterThan(afterFirst);

    await worker.stop();
  });
});
