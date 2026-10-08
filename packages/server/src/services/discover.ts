import { and, desc, eq, inArray, lt, ne } from 'drizzle-orm';
import type {
  DiscoverItem,
  DiscoverList,
  DiscoverSection,
  MarketMoverKind,
  StockQuote,
} from '@markettrader/shared';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import type { StockProvider } from '../providers/index.js';
import { isRegularSessionOpen, lastCompletedTradingSession } from './market-calendar.js';
import { sampleDailyPicks } from './discover/picks.js';

/** Market-mover lists in the order the Discover page shows them. */
export const MARKET_MOVER_KINDS: readonly MarketMoverKind[] = [
  'gainers',
  'losers',
  'active',
  'trending',
];

/** Entries kept per market-mover list. */
export const MARKET_MOVERS_COUNT = 5;

/** How many session dates of Discover rows are retained before pruning. */
export const DISCOVER_RETENTION_DAYS = 14;

/**
 * Fetches and stores any market-mover list still missing for the last
 * completed session. A no-op while a regular session is open: the provider's
 * lists describe the day in progress, which would be mislabelled as the
 * previous close. Each list is fetched independently, so one failure leaves
 * only that list missing for a later tick to retry.
 */
export async function refreshMarketMovers(
  db: Db,
  provider: StockProvider,
  now: Date = new Date(),
  onError?: (err: unknown, context: string) => void,
): Promise<void> {
  if (!provider.getMarketMovers || isRegularSessionOpen(now)) return;
  const sessionDate = lastCompletedTradingSession(now).isoDate;

  const existing = await db
    .select({ kind: schema.discoverMarketMovers.kind })
    .from(schema.discoverMarketMovers)
    .where(eq(schema.discoverMarketMovers.sessionDate, sessionDate));
  const have = new Set(existing.map((r) => r.kind));

  for (const kind of MARKET_MOVER_KINDS) {
    if (have.has(kind)) continue;
    try {
      const items = await provider.getMarketMovers(kind, MARKET_MOVERS_COUNT);
      // An empty answer is treated like a failure so a later tick retries it.
      if (items.length === 0) continue;
      await db
        .insert(schema.discoverMarketMovers)
        .values({
          sessionDate,
          kind,
          items: JSON.stringify(items),
          fetchedAt: new Date().toISOString(),
        })
        .onConflictDoNothing();
    } catch (err) {
      onError?.(err, `movers:${kind}`);
    }
  }
}

/**
 * Generates daily picks for every pending or active game that has none for
 * the last completed session. Picks need no intraday data, so this runs at any
 * time of day. All games share one batch quote; if it fails, picks are still
 * stored with null prices rather than leaving the game without a list.
 */
export async function refreshGamePicks(
  db: Db,
  provider: StockProvider,
  now: Date = new Date(),
  onError?: (err: unknown, context: string) => void,
): Promise<void> {
  const sessionDate = lastCompletedTradingSession(now).isoDate;
  const nowIso = now.toISOString();

  const candidates = await db
    .select({ id: schema.games.id, endDate: schema.games.endDate })
    .from(schema.games)
    .where(ne(schema.games.status, 'ended'));
  // The stored status can lag the end date until something recomputes it.
  const liveIds = candidates.filter((g) => nowIso < g.endDate).map((g) => g.id);
  if (liveIds.length === 0) return;

  const done = await db
    .select({ gameId: schema.gameDiscoverPicks.gameId })
    .from(schema.gameDiscoverPicks)
    .where(
      and(
        eq(schema.gameDiscoverPicks.sessionDate, sessionDate),
        inArray(schema.gameDiscoverPicks.gameId, liveIds),
      ),
    );
  const doneIds = new Set(done.map((r) => r.gameId));
  const pending = liveIds
    .filter((id) => !doneIds.has(id))
    .map((id) => ({ id, picks: sampleDailyPicks(id, sessionDate) }));
  if (pending.length === 0) return;

  const symbols = [...new Set(pending.flatMap((g) => g.picks.map((p) => p.symbol)))];
  let quotes = new Map<string, StockQuote>();
  try {
    quotes = (await provider.getQuotes?.(symbols)) ?? quotes;
  } catch (err) {
    onError?.(err, 'picks:quotes');
  }

  for (const game of pending) {
    const items: DiscoverItem[] = game.picks.map((p) => {
      const q = quotes.get(p.symbol);
      return {
        symbol: p.symbol,
        name: p.name,
        price: q?.price ?? null,
        changePct: q?.changePercent ?? null,
        sector: p.sector,
      };
    });
    try {
      await db
        .insert(schema.gameDiscoverPicks)
        .values({
          gameId: game.id,
          sessionDate,
          items: JSON.stringify(items),
          generatedAt: nowIso,
        })
        .onConflictDoNothing();
    } catch (err) {
      onError?.(err, `picks:${game.id}`);
    }
  }
}

/** Deletes Discover rows whose session date is more than `keepDays` before `now`. */
export async function pruneDiscover(
  db: Db,
  now: Date = new Date(),
  keepDays: number = DISCOVER_RETENTION_DAYS,
): Promise<void> {
  const cutoff = new Date(now.getTime() - keepDays * 86_400_000).toISOString().slice(0, 10);
  await db.delete(schema.gameDiscoverPicks).where(lt(schema.gameDiscoverPicks.sessionDate, cutoff));
  await db
    .delete(schema.discoverMarketMovers)
    .where(lt(schema.discoverMarketMovers.sessionDate, cutoff));
}

/**
 * Reads a game's newest stored Discover list: its daily picks plus whichever
 * market-mover lists exist for the same session. Never calls the provider.
 * Returns null when the worker has not generated picks for the game yet.
 */
export async function getDiscoverForGame(db: Db, gameId: string): Promise<DiscoverList | null> {
  const [picks] = await db
    .select()
    .from(schema.gameDiscoverPicks)
    .where(eq(schema.gameDiscoverPicks.gameId, gameId))
    .orderBy(desc(schema.gameDiscoverPicks.sessionDate))
    .limit(1);
  if (!picks) return null;

  const movers = await db
    .select({ kind: schema.discoverMarketMovers.kind, items: schema.discoverMarketMovers.items })
    .from(schema.discoverMarketMovers)
    .where(eq(schema.discoverMarketMovers.sessionDate, picks.sessionDate));
  const byKind = new Map(movers.map((m) => [m.kind, m.items]));

  const sections: DiscoverSection[] = [
    { kind: 'picks', items: JSON.parse(picks.items) as DiscoverItem[] },
  ];
  for (const kind of MARKET_MOVER_KINDS) {
    const raw = byKind.get(kind);
    if (raw) sections.push({ kind, items: JSON.parse(raw) as DiscoverItem[] });
  }

  return {
    gameId,
    sessionDate: picks.sessionDate,
    generatedAt: toIso(picks.generatedAt),
    sections,
  };
}

/**
 * Rows are written with ISO strings, but Postgres hands a `timestamptz` back
 * as `YYYY-MM-DD HH:MM:SS+00`; normalize so the API always returns ISO 8601.
 */
function toIso(raw: string): string {
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? raw : d.toISOString();
}
