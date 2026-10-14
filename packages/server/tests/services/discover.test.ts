import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import type { DiscoverItem, MarketMoverKind, StockQuote } from '@markettrader/shared';
import { createTestDb } from '../helpers/app.js';
import { schema } from '../../src/db/index.js';
import type { StockProvider } from '../../src/providers/index.js';
import { StockProviderError } from '../../src/providers/index.js';
import {
  getDiscoverForGame,
  pruneDiscover,
  refreshGamePicks,
  refreshMarketMovers,
} from '../../src/services/discover.js';
import { DAILY_PICKS_COUNT } from '../../src/services/discover/picks.js';

type Db = Awaited<ReturnType<typeof createTestDb>>;

// Tuesday 2026-05-19. Session dates below are NY dates.
const TUE_MID_SESSION = new Date(Date.UTC(2026, 4, 19, 18, 0, 0)); // 14:00 ET
const TUE_AFTER_CLOSE = new Date(Date.UTC(2026, 4, 19, 20, 5, 0)); // 16:05 ET
const WED_PRE_MARKET = new Date(Date.UTC(2026, 4, 20, 12, 0, 0)); // 08:00 ET

/** Provider double: canned movers per kind, optional per-kind failures, flat quotes. */
class FakeProvider implements StockProvider {
  moverCalls: MarketMoverKind[] = [];
  quoteBatches: string[][] = [];
  failing = new Set<MarketMoverKind>();

  async getMarketMovers(kind: MarketMoverKind, count: number): Promise<DiscoverItem[]> {
    this.moverCalls.push(kind);
    if (this.failing.has(kind)) throw new StockProviderError('PROVIDER_ERROR', 'boom');
    return Array.from({ length: count }, (_, i) => ({
      symbol: `${kind.toUpperCase().slice(0, 3)}${i}`,
      name: null,
      price: 10 + i,
      changePct: i,
    }));
  }

  async getQuotes(symbols: string[]): Promise<Map<string, StockQuote>> {
    this.quoteBatches.push(symbols);
    return new Map(
      symbols.map((s) => [
        s,
        { symbol: s, price: 50, change: 1, changePercent: 2, fetchedAt: new Date().toISOString() },
      ]),
    );
  }

  async getQuote(): Promise<StockQuote> {
    throw new Error('getQuote should not be called');
  }
  async searchSymbols() {
    return [];
  }
  async getHistory() {
    return [];
  }
  async getDetails(): Promise<never> {
    throw new Error('not used');
  }
}

let seed = 0;
async function seedGame(
  db: Db,
  status: 'pending' | 'active' | 'ended',
  endDate = '2027-01-01T00:00:00.000Z',
) {
  const [creator] = await db
    .insert(schema.users)
    .values({ username: `disc_${++seed}`, passwordHash: 'x' })
    .returning({ id: schema.users.id });
  if (!creator) throw new Error('user insert failed');
  const [game] = await db
    .insert(schema.games)
    .values({
      name: `g${seed}`,
      startDate: '2026-01-01T00:00:00.000Z',
      endDate,
      startingBalance: 10000,
      status,
      createdBy: creator.id,
    })
    .returning({ id: schema.games.id });
  if (!game) throw new Error('game insert failed');
  return game.id;
}

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
  // createTestDb shares one in-memory DB per file; start every test clean.
  await db.delete(schema.gameDiscoverPicks);
  await db.delete(schema.discoverMarketMovers);
  await db.delete(schema.games);
});

describe('refreshMarketMovers', () => {
  it('does nothing while a regular session is open', async () => {
    const provider = new FakeProvider();
    await refreshMarketMovers(db, provider, TUE_MID_SESSION);
    expect(provider.moverCalls).toEqual([]);
    expect(await db.select().from(schema.discoverMarketMovers)).toHaveLength(0);
  });

  it('stores all four lists keyed on the session that just closed', async () => {
    const provider = new FakeProvider();
    await refreshMarketMovers(db, provider, TUE_AFTER_CLOSE);
    const rows = await db.select().from(schema.discoverMarketMovers);
    expect(rows.map((r) => r.kind).sort()).toEqual(['active', 'gainers', 'losers', 'trending']);
    expect(new Set(rows.map((r) => r.sessionDate))).toEqual(new Set(['2026-05-19']));
    expect(JSON.parse(rows[0]!.items)).toHaveLength(5);
  });

  it('is idempotent: a later tick in the same window fetches nothing', async () => {
    const provider = new FakeProvider();
    await refreshMarketMovers(db, provider, TUE_AFTER_CLOSE);
    provider.moverCalls = [];
    await refreshMarketMovers(db, provider, WED_PRE_MARKET);
    expect(provider.moverCalls).toEqual([]);
  });

  it('isolates a failing list and retries only it on the next tick', async () => {
    const provider = new FakeProvider();
    provider.failing.add('trending');
    await refreshMarketMovers(db, provider, TUE_AFTER_CLOSE);
    expect((await db.select().from(schema.discoverMarketMovers)).map((r) => r.kind).sort()).toEqual(
      ['active', 'gainers', 'losers'],
    );

    provider.failing.clear();
    provider.moverCalls = [];
    await refreshMarketMovers(db, provider, WED_PRE_MARKET);
    expect(provider.moverCalls).toEqual(['trending']);
    expect(await db.select().from(schema.discoverMarketMovers)).toHaveLength(4);
  });

  it('skips silently when the provider has no market movers', async () => {
    const provider = new FakeProvider();
    const bare: StockProvider = {
      getQuote: provider.getQuote,
      searchSymbols: provider.searchSymbols,
      getHistory: provider.getHistory,
      getDetails: provider.getDetails,
    };
    await expect(refreshMarketMovers(db, bare, TUE_AFTER_CLOSE)).resolves.toBeUndefined();
    expect(await db.select().from(schema.discoverMarketMovers)).toHaveLength(0);
  });
});

describe('refreshGamePicks', () => {
  it('generates picks for pending and active games, even mid-session', async () => {
    const active = await seedGame(db, 'active');
    const pending = await seedGame(db, 'pending');
    const provider = new FakeProvider();

    await refreshGamePicks(db, provider, TUE_MID_SESSION);

    const rows = await db.select().from(schema.gameDiscoverPicks);
    expect(rows.map((r) => r.gameId).sort()).toEqual([active, pending].sort());
    // Mid-session Tuesday, the last completed session is Monday.
    expect(rows.every((r) => r.sessionDate === '2026-05-18')).toBe(true);
    const items = JSON.parse(rows[0]!.items) as DiscoverItem[];
    expect(items).toHaveLength(DAILY_PICKS_COUNT);
    expect(items[0]).toMatchObject({ price: 50, changePct: 2 });
    expect(typeof items[0]!.sector).toBe('string');
  });

  it('quotes every game in one batch call', async () => {
    await seedGame(db, 'active');
    await seedGame(db, 'active');
    const provider = new FakeProvider();
    await refreshGamePicks(db, provider, TUE_AFTER_CLOSE);
    expect(provider.quoteBatches).toHaveLength(1);
  });

  it('skips ended games, including ones whose end date passed before the status flipped', async () => {
    await seedGame(db, 'ended');
    await seedGame(db, 'active', '2026-05-01T00:00:00.000Z');
    await refreshGamePicks(db, new FakeProvider(), TUE_AFTER_CLOSE);
    expect(await db.select().from(schema.gameDiscoverPicks)).toHaveLength(0);
  });

  it('does not regenerate an existing list for the same session', async () => {
    const gameId = await seedGame(db, 'active');
    const provider = new FakeProvider();
    await refreshGamePicks(db, provider, TUE_AFTER_CLOSE);
    await refreshGamePicks(db, provider, WED_PRE_MARKET);
    expect(provider.quoteBatches).toHaveLength(1);
    const rows = await db
      .select()
      .from(schema.gameDiscoverPicks)
      .where(eq(schema.gameDiscoverPicks.gameId, gameId));
    expect(rows).toHaveLength(1);
  });

  it('stores null prices when quoting fails rather than skipping the game', async () => {
    await seedGame(db, 'active');
    const provider = new FakeProvider();
    provider.getQuotes = async () => {
      throw new StockProviderError('RATE_LIMITED', 'slow down');
    };
    await refreshGamePicks(db, provider, TUE_AFTER_CLOSE);
    const [row] = await db.select().from(schema.gameDiscoverPicks);
    const items = JSON.parse(row!.items) as DiscoverItem[];
    expect(items).toHaveLength(DAILY_PICKS_COUNT);
    expect(items.every((i) => i.price === null && i.changePct === null)).toBe(true);
  });

  it('re-prices an all-null row on a later tick once quotes come back', async () => {
    const gameId = await seedGame(db, 'active');
    const provider = new FakeProvider();
    const working = provider.getQuotes.bind(provider);
    // What CachedProvider returns under a 429 with a cold cache: no throw, no rows.
    provider.getQuotes = async () => new Map();
    await refreshGamePicks(db, provider, TUE_AFTER_CLOSE);

    provider.getQuotes = working;
    await refreshGamePicks(db, provider, WED_PRE_MARKET);

    const rows = await db
      .select()
      .from(schema.gameDiscoverPicks)
      .where(eq(schema.gameDiscoverPicks.gameId, gameId));
    expect(rows).toHaveLength(1);
    const items = JSON.parse(rows[0]!.items) as DiscoverItem[];
    expect(items.every((i) => i.price === 50)).toBe(true);
  });

  it('does not retry a row where only some quotes are missing', async () => {
    await seedGame(db, 'active');
    const provider = new FakeProvider();
    const working = provider.getQuotes.bind(provider);
    // Every symbol but one gets a quote — e.g. a delisted constituent.
    provider.getQuotes = async (symbols) => {
      const all = await working(symbols);
      all.delete(symbols[0]!);
      return all;
    };
    await refreshGamePicks(db, provider, TUE_AFTER_CLOSE);
    provider.quoteBatches = [];
    await refreshGamePicks(db, provider, WED_PRE_MARKET);
    expect(provider.quoteBatches).toHaveLength(0);
  });
});

describe('getDiscoverForGame', () => {
  it('returns null before any picks exist', async () => {
    const gameId = await seedGame(db, 'active');
    expect(await getDiscoverForGame(db, gameId)).toBeNull();
  });

  it('assembles picks first, then the movers lists for the same session', async () => {
    const gameId = await seedGame(db, 'active');
    const provider = new FakeProvider();
    await refreshMarketMovers(db, provider, TUE_AFTER_CLOSE);
    await refreshGamePicks(db, provider, TUE_AFTER_CLOSE);

    const list = await getDiscoverForGame(db, gameId);
    expect(list?.sessionDate).toBe('2026-05-19');
    expect(list?.sections.map((s) => s.kind)).toEqual([
      'picks',
      'gainers',
      'losers',
      'active',
      'trending',
    ]);
    expect(list?.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('returns the newest session and omits movers lists that are missing for it', async () => {
    const gameId = await seedGame(db, 'active');
    const provider = new FakeProvider();
    await refreshMarketMovers(db, provider, TUE_AFTER_CLOSE); // movers for 05-19
    await refreshGamePicks(db, provider, TUE_MID_SESSION); // picks for 05-18
    await refreshGamePicks(db, provider, TUE_AFTER_CLOSE); // picks for 05-19

    await db
      .delete(schema.discoverMarketMovers)
      .where(eq(schema.discoverMarketMovers.kind, 'losers'));
    const list = await getDiscoverForGame(db, gameId);
    expect(list?.sessionDate).toBe('2026-05-19');
    expect(list?.sections.map((s) => s.kind)).toEqual(['picks', 'gainers', 'active', 'trending']);
  });
});

describe('pruneDiscover', () => {
  it('deletes rows older than the retention window and keeps recent ones', async () => {
    const gameId = await seedGame(db, 'active');
    await db.insert(schema.gameDiscoverPicks).values([
      { gameId, sessionDate: '2026-04-01', items: '[]' },
      { gameId, sessionDate: '2026-05-18', items: '[]' },
    ]);
    await db.insert(schema.discoverMarketMovers).values([
      { sessionDate: '2026-04-01', kind: 'gainers', items: '[]' },
      { sessionDate: '2026-05-18', kind: 'gainers', items: '[]' },
    ]);

    await pruneDiscover(db, TUE_AFTER_CLOSE, 14);

    expect((await db.select().from(schema.gameDiscoverPicks)).map((r) => r.sessionDate)).toEqual([
      '2026-05-18',
    ]);
    expect((await db.select().from(schema.discoverMarketMovers)).map((r) => r.sessionDate)).toEqual(
      ['2026-05-18'],
    );
  });
});
