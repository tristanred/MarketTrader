# Additional Achievements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 40 new achievements + migrate `rock-bottom` to day-based semantics, by introducing two domain events (`position.closed`, `holdings.changed`), a new `game_player_stats` sidecar table, and one definition file per achievement.

**Architecture:** A per-player `game_player_stats` row is updated synchronously inside the existing trade and snapshot transactions. Two new domain events carry derived data so achievement handlers stay O(1). Achievement definitions live one-per-file under `packages/server/src/achievements/definitions/` and read from `game_player_stats` via `ctx.db`.

**Tech Stack:** Fastify v5, Drizzle ORM (SQLite + Postgres kept in sync by hand), TypeScript strict, vitest, React 19 + Vite frontend.

**Related spec:** [`docs/superpowers/specs/2026-05-25-additional-achievements-design.md`](../specs/2026-05-25-additional-achievements-design.md)

---

## File Structure

### Created

- `packages/server/src/services/game-player-stats.ts` — pure update functions used inside trade + snapshot transactions.
- `packages/server/src/achievements/definitions/<key>.ts` — one file per new achievement (40 files).
- `packages/server/tests/services/game-player-stats.test.ts` — unit tests for stat-update functions.
- `packages/server/tests/achievements/definitions/<key>.test.ts` — unit tests per new definition.
- `packages/server/drizzle/<timestamp>_add_game_player_stats.sql` — generated migration (do NOT hand-edit).

### Modified

- `packages/server/src/db/schema.sqlite.ts` — add `gamePlayerStats` table + `portfolios.openedAt` column.
- `packages/server/src/db/schema.pg.ts` — same, mirrored.
- `packages/server/src/events/types.ts` — add `PositionClosedEvent`, `HoldingsChangedEvent`.
- `packages/server/src/achievements/engine.ts` — extend `gameIdOf` to recognise the two new events.
- `packages/server/src/services/trade.ts` — update `executeTrade` to set `openedAt`, update `game_player_stats`, and return derived metrics needed for emits.
- `packages/server/src/services/portfolio-snapshot.ts` — update `game_player_stats` (peak/trough/rank/day counters) inside the snapshot tx.
- `packages/server/src/routes/trading.ts` — emit `position.closed` (sells) + `holdings.changed` after the existing `trade.executed`.
- `packages/server/src/routes/admin/trades.ts` — same.
- `packages/server/src/workers/pending-orders.ts` — same.
- `packages/server/src/achievements/definitions/index.ts` — register the new definitions.
- `packages/server/src/achievements/definitions/rock-bottom.ts` — migrate to day-based.
- `packages/frontend/src/components/achievements/AchievementRoster.tsx` (or wherever categories are rendered) — add labels for new categories.

---

## Execution Order

Tasks are grouped in phases. Within a phase, tasks can usually be done in order; phases must be sequential because later phases consume earlier outputs.

1. **Phase 1 — Schema & event types** (Tasks 1–4): foundation; nothing else compiles without these.
2. **Phase 2 — Stats writer** (Tasks 5–7): the `game_player_stats` updaters + tests.
3. **Phase 3 — Wire stats into trade + snapshot paths** (Tasks 8–11): integrate writes; emit new events from call sites.
4. **Phase 4 — Engine plumbing** (Task 12): teach engine to scope the new events.
5. **Phase 5 — Achievement definitions** (Tasks 13–52): one task per new definition (40 tasks), plus rock-bottom migration.
6. **Phase 6 — Frontend category labels & smoke test** (Tasks 53–54).
7. **Phase 7 — Final verification** (Task 55).

---

## Phase 1 — Schema & Event Types

### Task 1: Add `gamePlayerStats` table and `portfolios.openedAt` to SQLite schema

**Files:**
- Modify: `packages/server/src/db/schema.sqlite.ts`

- [ ] **Step 1: Append the table definition and add `openedAt` to `portfolios`**

In `schema.sqlite.ts`, modify the `portfolios` table definition to add `openedAt`:

```ts
export const portfolios = sqliteTable(
  'portfolios',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    gamePlayerId: text('game_player_id')
      .notNull()
      .references(() => gamePlayers.id, { onDelete: 'cascade' }),
    symbol: text('symbol').notNull(),
    quantity: integer('quantity').notNull(),
    avgCostBasis: real('avg_cost_basis').notNull(),
    /** ISO 8601 timestamp set when quantity went 0 → positive. Cleared when the row is deleted (full close). */
    openedAt: text('opened_at'),
  },
  (t) => [unique().on(t.gamePlayerId, t.symbol)],
);
```

Then append at the end of the file (before the final `export` of any aggregate):

```ts
/**
 * Per-player aggregate stats used by achievements. 1:1 sidecar to {@link gamePlayers}.
 * Updated synchronously inside the trade and snapshot transactions so a handler
 * reading stats never sees a value behind the canonical writes.
 */
export const gamePlayerStats = sqliteTable('game_player_stats', {
  gamePlayerId: text('game_player_id')
    .primaryKey()
    .references(() => gamePlayers.id, { onDelete: 'cascade' }),

  peakPortfolioValue: real('peak_portfolio_value'),
  peakPortfolioAt: text('peak_portfolio_at'),
  troughPortfolioValue: real('trough_portfolio_value'),
  troughPortfolioAt: text('trough_portfolio_at'),

  bestRank: integer('best_rank'),
  worstRank: integer('worst_rank'),
  lastRank: integer('last_rank'),

  daysAtRankOne: integer('days_at_rank_one').notNull().default(0),
  consecutiveDaysAtRankOne: integer('consecutive_days_at_rank_one').notNull().default(0),
  daysInTopThree: integer('days_in_top_three').notNull().default(0),
  consecutiveDaysAtOrAboveMedian: integer('consecutive_days_at_or_above_median').notNull().default(0),
  consecutiveDaysInLastPlace: integer('consecutive_days_in_last_place').notNull().default(0),
  lastDayCounted: text('last_day_counted'),
  lastDayRank: integer('last_day_rank'),

  totalTrades: integer('total_trades').notNull().default(0),
  buyTrades: integer('buy_trades').notNull().default(0),
  sellTrades: integer('sell_trades').notNull().default(0),
  distinctSymbolsTradedEver: integer('distinct_symbols_traded_ever').notNull().default(0),
  totalVolumeTraded: real('total_volume_traded').notNull().default(0),

  realizedPnl: real('realized_pnl').notNull().default(0),
  winningClosedPositions: integer('winning_closed_positions').notNull().default(0),
  losingClosedPositions: integer('losing_closed_positions').notNull().default(0),
  consecutiveWins: integer('consecutive_wins').notNull().default(0),
  bestSinglePnl: real('best_single_pnl'),
  worstSinglePnl: real('worst_single_pnl'),
  bestSinglePnlPct: real('best_single_pnl_pct'),
  worstSinglePnlPct: real('worst_single_pnl_pct'),

  shortestHoldMs: integer('shortest_hold_ms'),
  longestHoldMs: integer('longest_hold_ms'),

  updatedAt: text('updated_at').default(sql`(datetime('now'))`).notNull(),
});
```

- [ ] **Step 2: Re-export via the `schema` aggregate**

If `packages/server/src/db/index.ts` or a re-export file collects schema tables for the `schema` object used in queries, ensure `gamePlayerStats` is included. (Re-read the file first to confirm where to add it.)

- [ ] **Step 3: Run typecheck to confirm syntax**

Run: `pnpm --filter server typecheck`
Expected: no new errors. (Errors from later tasks not present yet are OK.)

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/db/schema.sqlite.ts packages/server/src/db/index.ts
git commit -m "feat(db): add game_player_stats table and portfolios.openedAt (sqlite)"
```

---

### Task 2: Mirror schema changes into Postgres schema

**Files:**
- Modify: `packages/server/src/db/schema.pg.ts`

- [ ] **Step 1: Add the same `openedAt` column to the pg `portfolios` table**

```ts
openedAt: timestamp('opened_at'),
```

(Match existing pg column conventions for timestamp columns in this file; do NOT use `text` even though sqlite does — pg has a native timestamp type.)

- [ ] **Step 2: Append the `gamePlayerStats` table mirrored from sqlite**

Use the pg-style imports already in the file (`pgTable`, `real`, `integer`, `text`, `timestamp`). Use `timestamp` for `peakPortfolioAt`, `troughPortfolioAt`, `updatedAt`. Use `text` for `lastDayCounted` (since it's a `YYYY-MM-DD` string, not a real timestamp). Match the column names and defaults exactly:

```ts
export const gamePlayerStats = pgTable('game_player_stats', {
  gamePlayerId: text('game_player_id')
    .primaryKey()
    .references(() => gamePlayers.id, { onDelete: 'cascade' }),
  peakPortfolioValue: real('peak_portfolio_value'),
  peakPortfolioAt: timestamp('peak_portfolio_at'),
  troughPortfolioValue: real('trough_portfolio_value'),
  troughPortfolioAt: timestamp('trough_portfolio_at'),
  bestRank: integer('best_rank'),
  worstRank: integer('worst_rank'),
  lastRank: integer('last_rank'),
  daysAtRankOne: integer('days_at_rank_one').notNull().default(0),
  consecutiveDaysAtRankOne: integer('consecutive_days_at_rank_one').notNull().default(0),
  daysInTopThree: integer('days_in_top_three').notNull().default(0),
  consecutiveDaysAtOrAboveMedian: integer('consecutive_days_at_or_above_median').notNull().default(0),
  consecutiveDaysInLastPlace: integer('consecutive_days_in_last_place').notNull().default(0),
  lastDayCounted: text('last_day_counted'),
  lastDayRank: integer('last_day_rank'),
  totalTrades: integer('total_trades').notNull().default(0),
  buyTrades: integer('buy_trades').notNull().default(0),
  sellTrades: integer('sell_trades').notNull().default(0),
  distinctSymbolsTradedEver: integer('distinct_symbols_traded_ever').notNull().default(0),
  totalVolumeTraded: real('total_volume_traded').notNull().default(0),
  realizedPnl: real('realized_pnl').notNull().default(0),
  winningClosedPositions: integer('winning_closed_positions').notNull().default(0),
  losingClosedPositions: integer('losing_closed_positions').notNull().default(0),
  consecutiveWins: integer('consecutive_wins').notNull().default(0),
  bestSinglePnl: real('best_single_pnl'),
  worstSinglePnl: real('worst_single_pnl'),
  bestSinglePnlPct: real('best_single_pnl_pct'),
  worstSinglePnlPct: real('worst_single_pnl_pct'),
  shortestHoldMs: integer('shortest_hold_ms'),
  longestHoldMs: integer('longest_hold_ms'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter server typecheck`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/db/schema.pg.ts
git commit -m "feat(db): mirror game_player_stats and openedAt in pg schema"
```

---

### Task 3: Generate Drizzle migration for the new table and column

**Files:**
- Create: `packages/server/drizzle/<timestamp>_…_.sql` (auto-generated; do NOT hand-edit afterward)

- [ ] **Step 1: Generate the migration**

Run: `pnpm --filter server db:generate`
Expected: a new file appears under `packages/server/drizzle/`. Confirm the SQL contains `CREATE TABLE game_player_stats` and `ALTER TABLE portfolios ADD COLUMN opened_at`.

- [ ] **Step 2: Apply the migration to a fresh dev DB to verify**

```bash
rm -f packages/server/dev.db
DATABASE_URL=./dev.db pnpm --filter server db:migrate
```

Expected: migration runs without error.

- [ ] **Step 3: Commit the generated migration**

```bash
git add packages/server/drizzle/
git commit -m "feat(db): generate migration for game_player_stats + opened_at"
```

---

### Task 4: Add `PositionClosedEvent` and `HoldingsChangedEvent` to the event union

**Files:**
- Modify: `packages/server/src/events/types.ts`

- [ ] **Step 1: Add the two interfaces to the union**

In `events/types.ts`, extend `DomainEvent` and append the two interfaces:

```ts
export type DomainEvent =
  | TradeExecutedEvent
  | SnapshotRecordedEvent
  | GameStartedEvent
  | GameEndedEvent
  | PlayerJoinedEvent
  | EngineTickEvent
  | PositionClosedEvent
  | HoldingsChangedEvent;

/**
 * Fired after a sell trade commits. Carries realized P&L and hold duration so
 * achievement handlers don't need to look up cost basis themselves.
 */
export interface PositionClosedEvent {
  type: 'position.closed';
  gameId: string;
  gamePlayerId: string;
  symbol: string;
  /** Quantity sold in the closing trade. */
  quantity: number;
  /** Realized P&L for this sell slice: (sellPrice − avgCostBasis) × quantity. */
  realizedPnl: number;
  /** Realized P&L as a fraction of cost basis: (sellPrice / avgCostBasis) − 1. */
  realizedPnlPct: number;
  /** Milliseconds between the most recent position open (qty 0 → positive) and this sell. */
  holdDurationMs: number;
  /** True when this sell brought the holding to 0. */
  fullyClosed: boolean;
  closedAt: string;
}

/**
 * Fired after any trade commits. Carries derived holdings metrics so portfolio-
 * shape achievements stay O(1).
 */
export interface HoldingsChangedEvent {
  type: 'holdings.changed';
  gameId: string;
  gamePlayerId: string;
  /** Count of portfolio rows with quantity > 0 after the trade. */
  distinctSymbols: number;
  /** Largest single-symbol value ÷ total portfolio value (0 if no holdings). */
  topConcentrationRatio: number;
  /** Cash ÷ total portfolio value. */
  cashRatio: number;
  changedAt: string;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter server typecheck`
Expected: no errors yet (event types are still unused).

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/events/types.ts
git commit -m "feat(events): add position.closed and holdings.changed event types"
```

---

## Phase 2 — Stats Writer

### Task 5: Create `services/game-player-stats.ts` with `ensureStatsRow` + day-key helper

**Files:**
- Create: `packages/server/src/services/game-player-stats.ts`
- Test: `packages/server/tests/services/game-player-stats.test.ts`

- [ ] **Step 1: Write the failing test for `utcDayKey`**

```ts
// packages/server/tests/services/game-player-stats.test.ts
import { describe, it, expect } from 'vitest';
import { utcDayKey } from '../../src/services/game-player-stats.js';

describe('utcDayKey', () => {
  it('formats an ISO timestamp as YYYY-MM-DD in UTC', () => {
    expect(utcDayKey('2026-05-25T23:59:00.000Z')).toBe('2026-05-25');
    expect(utcDayKey('2026-05-26T00:00:00.000Z')).toBe('2026-05-26');
  });

  it('uses UTC, not local time', () => {
    // 2026-05-25T23:30 UTC is 2026-05-25, not 2026-05-26 even in JST (+9)
    expect(utcDayKey('2026-05-25T23:30:00.000Z')).toBe('2026-05-25');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter server test -- tests/services/game-player-stats.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Create the file with `utcDayKey` and `ensureStatsRow`**

```ts
// packages/server/src/services/game-player-stats.ts
import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';

/** Returns the `YYYY-MM-DD` UTC calendar day for an ISO 8601 timestamp. */
export function utcDayKey(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10);
}

/**
 * Upserts a zero-initialised `game_player_stats` row for the given player and
 * returns its current snapshot. Idempotent.
 */
export async function ensureStatsRow(db: Db, gamePlayerId: string) {
  await db
    .insert(schema.gamePlayerStats)
    .values({ gamePlayerId })
    .onConflictDoNothing({ target: schema.gamePlayerStats.gamePlayerId });
  const [row] = await db
    .select()
    .from(schema.gamePlayerStats)
    .where(eq(schema.gamePlayerStats.gamePlayerId, gamePlayerId))
    .limit(1);
  if (!row) throw new Error(`Stats row missing after upsert for ${gamePlayerId}`);
  return row;
}
```

- [ ] **Step 4: Run test to confirm pass**

Run: `pnpm --filter server test -- tests/services/game-player-stats.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/game-player-stats.ts packages/server/tests/services/game-player-stats.test.ts
git commit -m "feat(stats): scaffolding for game_player_stats writer (utcDayKey, ensureStatsRow)"
```

---

### Task 6: Add `applyTradeStats` — updates trade-driven columns on every trade

**Files:**
- Modify: `packages/server/src/services/game-player-stats.ts`
- Modify: `packages/server/tests/services/game-player-stats.test.ts`

- [ ] **Step 1: Write failing tests**

Append to the test file:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from '../helpers/db.js'; // existing test helper — confirm path matches the codebase convention
import { applyTradeStats } from '../../src/services/game-player-stats.js';
import { schema } from '../../src/db/index.js';
import { eq } from 'drizzle-orm';

describe('applyTradeStats', () => {
  let db: Awaited<ReturnType<typeof makeTestDb>>;
  let gamePlayerId: string;

  beforeEach(async () => {
    db = await makeTestDb();
    gamePlayerId = await seedGamePlayer(db); // see helper note below
  });

  it('increments totalTrades, buyTrades, totalVolumeTraded on a buy', async () => {
    await applyTradeStats(db, {
      gamePlayerId,
      direction: 'buy',
      symbol: 'AAPL',
      quantity: 10,
      price: 100,
    });
    const [row] = await db
      .select()
      .from(schema.gamePlayerStats)
      .where(eq(schema.gamePlayerStats.gamePlayerId, gamePlayerId));
    expect(row!.totalTrades).toBe(1);
    expect(row!.buyTrades).toBe(1);
    expect(row!.sellTrades).toBe(0);
    expect(row!.totalVolumeTraded).toBe(1000);
    expect(row!.distinctSymbolsTradedEver).toBe(1);
  });

  it('does not double-count distinctSymbolsTradedEver on a repeat symbol', async () => {
    await applyTradeStats(db, { gamePlayerId, direction: 'buy', symbol: 'AAPL', quantity: 1, price: 1 });
    await applyTradeStats(db, { gamePlayerId, direction: 'buy', symbol: 'AAPL', quantity: 1, price: 1 });
    const [row] = await db
      .select()
      .from(schema.gamePlayerStats)
      .where(eq(schema.gamePlayerStats.gamePlayerId, gamePlayerId));
    expect(row!.distinctSymbolsTradedEver).toBe(1);
  });
});
```

**Helper note:** Confirm the test-DB helper file. The repo already has WS test helpers; if no `makeTestDb` exists, copy the pattern used in `packages/server/tests/achievements/engine.test.ts` for setting up an in-memory SQLite db, and add a small `seedGamePlayer` helper that inserts a user + game + game_player row and returns the id. Re-read `packages/server/tests/achievements/engine.test.ts` to mirror its setup pattern before writing this test.

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter server test -- tests/services/game-player-stats.test.ts`
Expected: FAIL (`applyTradeStats` undefined).

- [ ] **Step 3: Implement**

Append to `services/game-player-stats.ts`:

```ts
import { and, sql } from 'drizzle-orm';

export interface ApplyTradeStatsParams {
  gamePlayerId: string;
  direction: 'buy' | 'sell';
  symbol: string;
  quantity: number;
  price: number;
}

/**
 * Updates trade-driven stats columns for one executed trade. Must be called
 * inside the same transaction that wrote the trade row. Idempotency is the
 * caller's concern — never call twice for the same trade.
 */
export async function applyTradeStats(db: Db, params: ApplyTradeStatsParams): Promise<void> {
  await ensureStatsRow(db, params.gamePlayerId);

  // Compute distinctSymbolsTradedEver delta: 1 if no prior trade on this symbol, else 0.
  const [prior] = await db
    .select({ id: schema.trades.id })
    .from(schema.trades)
    .where(
      and(
        eq(schema.trades.gamePlayerId, params.gamePlayerId),
        eq(schema.trades.symbol, params.symbol),
      ),
    )
    .limit(1);
  const distinctDelta = prior ? 0 : 1;
  const volume = params.quantity * params.price;
  const now = new Date().toISOString();

  await db
    .update(schema.gamePlayerStats)
    .set({
      totalTrades: sql`${schema.gamePlayerStats.totalTrades} + 1`,
      buyTrades: sql`${schema.gamePlayerStats.buyTrades} + ${params.direction === 'buy' ? 1 : 0}`,
      sellTrades: sql`${schema.gamePlayerStats.sellTrades} + ${params.direction === 'sell' ? 1 : 0}`,
      totalVolumeTraded: sql`${schema.gamePlayerStats.totalVolumeTraded} + ${volume}`,
      distinctSymbolsTradedEver: sql`${schema.gamePlayerStats.distinctSymbolsTradedEver} + ${distinctDelta}`,
      updatedAt: now,
    })
    .where(eq(schema.gamePlayerStats.gamePlayerId, params.gamePlayerId));
}
```

**Important subtlety:** `applyTradeStats` queries `trades` *before* the new trade is inserted by the caller — that's what makes the "prior" lookup correct. Document this in the JSDoc by extending it to "Must be called inside the trade transaction BEFORE the new trade row is inserted."

Adjust the JSDoc accordingly.

- [ ] **Step 4: Run test to pass**

Run: `pnpm --filter server test -- tests/services/game-player-stats.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/game-player-stats.ts packages/server/tests/services/game-player-stats.test.ts
git commit -m "feat(stats): applyTradeStats updates trade-driven counters"
```

---

### Task 7: Add `applyPositionCloseStats` and `applySnapshotStats`

**Files:**
- Modify: `packages/server/src/services/game-player-stats.ts`
- Modify: `packages/server/tests/services/game-player-stats.test.ts`

- [ ] **Step 1: Write failing tests for `applyPositionCloseStats`**

Append:

```ts
describe('applyPositionCloseStats', () => {
  it('records a winning close: increments wins, consecutiveWins, updates bestSinglePnl', async () => {
    const db = await makeTestDb();
    const gpId = await seedGamePlayer(db);
    await applyPositionCloseStats(db, { gamePlayerId: gpId, realizedPnl: 50, realizedPnlPct: 0.5, holdDurationMs: 1000 });
    const [row] = await db.select().from(schema.gamePlayerStats).where(eq(schema.gamePlayerStats.gamePlayerId, gpId));
    expect(row!.winningClosedPositions).toBe(1);
    expect(row!.losingClosedPositions).toBe(0);
    expect(row!.consecutiveWins).toBe(1);
    expect(row!.realizedPnl).toBe(50);
    expect(row!.bestSinglePnl).toBe(50);
    expect(row!.bestSinglePnlPct).toBe(0.5);
    expect(row!.shortestHoldMs).toBe(1000);
    expect(row!.longestHoldMs).toBe(1000);
  });

  it('records a losing close: resets consecutiveWins, updates worstSinglePnl', async () => {
    const db = await makeTestDb();
    const gpId = await seedGamePlayer(db);
    await applyPositionCloseStats(db, { gamePlayerId: gpId, realizedPnl: 10, realizedPnlPct: 0.1, holdDurationMs: 500 });
    await applyPositionCloseStats(db, { gamePlayerId: gpId, realizedPnl: -30, realizedPnlPct: -0.3, holdDurationMs: 2000 });
    const [row] = await db.select().from(schema.gamePlayerStats).where(eq(schema.gamePlayerStats.gamePlayerId, gpId));
    expect(row!.consecutiveWins).toBe(0);
    expect(row!.losingClosedPositions).toBe(1);
    expect(row!.realizedPnl).toBe(-20);
    expect(row!.worstSinglePnl).toBe(-30);
    expect(row!.worstSinglePnlPct).toBe(-0.3);
    expect(row!.shortestHoldMs).toBe(500);
    expect(row!.longestHoldMs).toBe(2000);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter server test -- tests/services/game-player-stats.test.ts`
Expected: FAIL (`applyPositionCloseStats` undefined).

- [ ] **Step 3: Implement `applyPositionCloseStats`**

Append:

```ts
export interface ApplyPositionCloseStatsParams {
  gamePlayerId: string;
  realizedPnl: number;
  realizedPnlPct: number;
  holdDurationMs: number;
}

/**
 * Updates P&L-driven and hold-duration columns on every closed position
 * (i.e. every sell). Idempotency is the caller's concern.
 */
export async function applyPositionCloseStats(
  db: Db,
  params: ApplyPositionCloseStatsParams,
): Promise<void> {
  await ensureStatsRow(db, params.gamePlayerId);
  const row = await ensureStatsRow(db, params.gamePlayerId);
  const isWin = params.realizedPnl > 0;
  const now = new Date().toISOString();

  const nextBestPnl = row.bestSinglePnl == null || params.realizedPnl > row.bestSinglePnl ? params.realizedPnl : row.bestSinglePnl;
  const nextBestPct = row.bestSinglePnlPct == null || params.realizedPnlPct > row.bestSinglePnlPct ? params.realizedPnlPct : row.bestSinglePnlPct;
  const nextWorstPnl = row.worstSinglePnl == null || params.realizedPnl < row.worstSinglePnl ? params.realizedPnl : row.worstSinglePnl;
  const nextWorstPct = row.worstSinglePnlPct == null || params.realizedPnlPct < row.worstSinglePnlPct ? params.realizedPnlPct : row.worstSinglePnlPct;
  const nextShortest = row.shortestHoldMs == null || params.holdDurationMs < row.shortestHoldMs ? params.holdDurationMs : row.shortestHoldMs;
  const nextLongest = row.longestHoldMs == null || params.holdDurationMs > row.longestHoldMs ? params.holdDurationMs : row.longestHoldMs;

  await db
    .update(schema.gamePlayerStats)
    .set({
      realizedPnl: sql`${schema.gamePlayerStats.realizedPnl} + ${params.realizedPnl}`,
      winningClosedPositions: sql`${schema.gamePlayerStats.winningClosedPositions} + ${isWin ? 1 : 0}`,
      losingClosedPositions: sql`${schema.gamePlayerStats.losingClosedPositions} + ${isWin ? 0 : 1}`,
      consecutiveWins: isWin
        ? sql`${schema.gamePlayerStats.consecutiveWins} + 1`
        : 0,
      bestSinglePnl: nextBestPnl,
      bestSinglePnlPct: nextBestPct,
      worstSinglePnl: nextWorstPnl,
      worstSinglePnlPct: nextWorstPct,
      shortestHoldMs: nextShortest,
      longestHoldMs: nextLongest,
      updatedAt: now,
    })
    .where(eq(schema.gamePlayerStats.gamePlayerId, params.gamePlayerId));
}
```

- [ ] **Step 4: Write failing tests for `applySnapshotStats`**

Append:

```ts
describe('applySnapshotStats', () => {
  it('updates peak on first snapshot', async () => {
    const db = await makeTestDb();
    const gpId = await seedGamePlayer(db);
    await applySnapshotStats(db, {
      gamePlayerId: gpId,
      totalValue: 120_000,
      rank: 2,
      totalPlayers: 5,
      capturedAt: '2026-05-25T10:00:00.000Z',
    });
    const [row] = await db.select().from(schema.gamePlayerStats).where(eq(schema.gamePlayerStats.gamePlayerId, gpId));
    expect(row!.peakPortfolioValue).toBe(120_000);
    expect(row!.troughPortfolioValue).toBe(120_000);
    expect(row!.bestRank).toBe(2);
    expect(row!.worstRank).toBe(2);
    expect(row!.lastRank).toBe(2);
  });

  it('advances day counters only on day rollover', async () => {
    const db = await makeTestDb();
    const gpId = await seedGamePlayer(db);
    // Day 1: rank 1 (multiple snapshots same day → day counters advance once)
    await applySnapshotStats(db, { gamePlayerId: gpId, totalValue: 100, rank: 1, totalPlayers: 5, capturedAt: '2026-05-25T10:00:00.000Z' });
    await applySnapshotStats(db, { gamePlayerId: gpId, totalValue: 100, rank: 1, totalPlayers: 5, capturedAt: '2026-05-25T18:00:00.000Z' });
    let [row] = await db.select().from(schema.gamePlayerStats).where(eq(schema.gamePlayerStats.gamePlayerId, gpId));
    expect(row!.daysAtRankOne).toBe(0); // first snapshot of a day "seeds" lastDayCounted; advance happens on next day
    // Day 2: roll over. The advance is based on the most recent prior-day rank (1).
    await applySnapshotStats(db, { gamePlayerId: gpId, totalValue: 100, rank: 1, totalPlayers: 5, capturedAt: '2026-05-26T10:00:00.000Z' });
    [row] = await db.select().from(schema.gamePlayerStats).where(eq(schema.gamePlayerStats.gamePlayerId, gpId));
    expect(row!.daysAtRankOne).toBe(1);
    expect(row!.consecutiveDaysAtRankOne).toBe(1);
  });

  it('resets consecutive counters when standing breaks', async () => {
    const db = await makeTestDb();
    const gpId = await seedGamePlayer(db);
    // Day 1 rank 1 → seed
    await applySnapshotStats(db, { gamePlayerId: gpId, totalValue: 100, rank: 1, totalPlayers: 5, capturedAt: '2026-05-25T10:00:00.000Z' });
    // Day 2 rank 1 → advance (prior day rank 1)
    await applySnapshotStats(db, { gamePlayerId: gpId, totalValue: 100, rank: 1, totalPlayers: 5, capturedAt: '2026-05-26T10:00:00.000Z' });
    // Day 3 rank 3 → advance (prior day rank 1: still adds), but next rollover should reset consecutive
    await applySnapshotStats(db, { gamePlayerId: gpId, totalValue: 100, rank: 3, totalPlayers: 5, capturedAt: '2026-05-27T10:00:00.000Z' });
    // Day 4: rollover, prior day was rank 3 → break the streak
    await applySnapshotStats(db, { gamePlayerId: gpId, totalValue: 100, rank: 3, totalPlayers: 5, capturedAt: '2026-05-28T10:00:00.000Z' });
    const [row] = await db.select().from(schema.gamePlayerStats).where(eq(schema.gamePlayerStats.gamePlayerId, gpId));
    expect(row!.consecutiveDaysAtRankOne).toBe(0);
    expect(row!.daysAtRankOne).toBe(2);
  });
});
```

- [ ] **Step 5: Run to confirm failure**

Run: `pnpm --filter server test -- tests/services/game-player-stats.test.ts`
Expected: FAIL.

- [ ] **Step 6: Implement `applySnapshotStats`**

Append:

```ts
export interface ApplySnapshotStatsParams {
  gamePlayerId: string;
  totalValue: number;
  rank: number;
  totalPlayers: number;
  capturedAt: string;
}

/**
 * Updates snapshot-driven stats columns for one portfolio snapshot. Must be
 * called inside the same transaction that wrote the snapshot.
 *
 * Day-level counters (daysAtRankOne, consecutiveDaysAtRankOne, etc.) are
 * advanced exactly once per UTC day per player. On the first snapshot of a
 * new day, counters are advanced using {@link ApplySnapshotStatsParams.rank}
 * — but the *value* used for "was the player at rank 1 yesterday?" is the
 * `lastDayRank` already stored on the stats row from the prior day's last
 * snapshot. The first ever snapshot only seeds `lastDayCounted` and
 * `lastDayRank` without advancing counters (no prior day to count for).
 */
export async function applySnapshotStats(
  db: Db,
  params: ApplySnapshotStatsParams,
): Promise<void> {
  const row = await ensureStatsRow(db, params.gamePlayerId);
  const now = new Date().toISOString();
  const dayKey = utcDayKey(params.capturedAt);

  // Always-updated columns:
  const nextPeak = row.peakPortfolioValue == null || params.totalValue > row.peakPortfolioValue ? params.totalValue : row.peakPortfolioValue;
  const nextPeakAt = row.peakPortfolioValue == null || params.totalValue > row.peakPortfolioValue ? params.capturedAt : row.peakPortfolioAt;
  const nextTrough = row.troughPortfolioValue == null || params.totalValue < row.troughPortfolioValue ? params.totalValue : row.troughPortfolioValue;
  const nextTroughAt = row.troughPortfolioValue == null || params.totalValue < row.troughPortfolioValue ? params.capturedAt : row.troughPortfolioAt;
  const nextBestRank = row.bestRank == null || params.rank < row.bestRank ? params.rank : row.bestRank;
  const nextWorstRank = row.worstRank == null || params.rank > row.worstRank ? params.rank : row.worstRank;

  // Day-level counters:
  let daysAtRankOne = row.daysAtRankOne;
  let consecAtOne = row.consecutiveDaysAtRankOne;
  let daysInTop3 = row.daysInTopThree;
  let consecMedian = row.consecutiveDaysAtOrAboveMedian;
  let consecLast = row.consecutiveDaysInLastPlace;
  let lastDayCounted = row.lastDayCounted;
  let lastDayRank = row.lastDayRank;

  if (row.lastDayCounted == null) {
    // First-ever snapshot: just seed, no advance.
    lastDayCounted = dayKey;
    lastDayRank = params.rank;
  } else if (row.lastDayCounted !== dayKey) {
    // New day rolled over. Advance using the *prior day's* final rank.
    const priorRank = row.lastDayRank ?? params.rank;
    const wasAtOne = priorRank === 1;
    const wasInTop3 = priorRank <= 3;
    // Median: rank ≤ ceil(totalPlayers / 2). Use the CURRENT snapshot's
    // totalPlayers as an approximation; player count rarely changes mid-game.
    const wasAboveMedian = priorRank <= Math.ceil(params.totalPlayers / 2);
    const wasLast = params.totalPlayers > 1 && priorRank === params.totalPlayers;

    daysAtRankOne += wasAtOne ? 1 : 0;
    consecAtOne = wasAtOne ? consecAtOne + 1 : 0;
    daysInTop3 += wasInTop3 ? 1 : 0;
    consecMedian = wasAboveMedian ? consecMedian + 1 : 0;
    consecLast = wasLast ? consecLast + 1 : 0;

    lastDayCounted = dayKey;
    lastDayRank = params.rank;
  } else {
    // Same day, multiple snapshots: just keep lastDayRank fresh so the
    // rollover-time advance uses the latest known rank for that day.
    lastDayRank = params.rank;
  }

  await db
    .update(schema.gamePlayerStats)
    .set({
      peakPortfolioValue: nextPeak,
      peakPortfolioAt: nextPeakAt,
      troughPortfolioValue: nextTrough,
      troughPortfolioAt: nextTroughAt,
      bestRank: nextBestRank,
      worstRank: nextWorstRank,
      lastRank: params.rank,
      daysAtRankOne,
      consecutiveDaysAtRankOne: consecAtOne,
      daysInTopThree: daysInTop3,
      consecutiveDaysAtOrAboveMedian: consecMedian,
      consecutiveDaysInLastPlace: consecLast,
      lastDayCounted,
      lastDayRank,
      updatedAt: now,
    })
    .where(eq(schema.gamePlayerStats.gamePlayerId, params.gamePlayerId));
}
```

- [ ] **Step 7: Run test to pass**

Run: `pnpm --filter server test -- tests/services/game-player-stats.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/services/game-player-stats.ts packages/server/tests/services/game-player-stats.test.ts
git commit -m "feat(stats): applyPositionCloseStats + applySnapshotStats with day rollover"
```

---

## Phase 3 — Wire Stats into Trade + Snapshot Paths

### Task 8: Extend `executeTrade` to track `openedAt`, call `applyTradeStats`, and return derived metrics

**Files:**
- Modify: `packages/server/src/services/trade.ts`

- [ ] **Step 1: Re-read the file to confirm current shape**

Open `packages/server/src/services/trade.ts` to confirm `executeTrade`'s structure.

- [ ] **Step 2: Extend the return type**

Above `executeTrade`, add:

```ts
/** Returned by {@link executeTrade}. Carries derived data needed to emit position.closed / holdings.changed. */
export interface ExecuteTradeResult {
  trade: Trade;
  /** Realized P&L for this trade. 0 for buys. */
  realizedPnl: number;
  /** Realized P&L % of cost basis. 0 for buys. */
  realizedPnlPct: number;
  /** ms between most recent open and now. 0 for buys. */
  holdDurationMs: number;
  /** True iff this sell brought the position to 0. False for buys and partial sells. */
  fullyClosed: boolean;
  /** Distinct symbols (qty > 0) for this player after the trade. */
  distinctSymbols: number;
}
```

Change the return signature to `Promise<ExecuteTradeResult>`.

- [ ] **Step 3: Inside the transaction, set/clear `openedAt` and compute realized P&L**

In the buy branch, when inserting a new portfolio row, set `openedAt: executedAt`. When updating an existing row, leave `openedAt` untouched.

In the sell branch (non-resting), compute:

```ts
const sellAvgCost = Number(holding!.avgCostBasis);
const realizedPnl = (price - sellAvgCost) * quantity;
const realizedPnlPct = sellAvgCost > 0 ? price / sellAvgCost - 1 : 0;
const openedAt = holding!.openedAt;
const holdDurationMs = openedAt
  ? new Date(executedAt).getTime() - new Date(openedAt).getTime()
  : 0;
const fullyClosed = newQty === 0;
```

For resting sells, the portfolio row was already decremented at placement, so `holding` may already be deleted. In that case, treat as `realizedPnl=0, realizedPnlPct=0, holdDurationMs=0, fullyClosed=false` and add a `// TODO(achievements):` inline comment: resting sell P&L would need to be captured at placement time, not fill time, which is out of scope for this plan. (Document in `docs/design.md` too — see Task 10.)

- [ ] **Step 4: Call `applyTradeStats` and (for sells) `applyPositionCloseStats` inside the tx**

After the trade row is inserted/updated but before returning from the tx:

```ts
import { applyTradeStats, applyPositionCloseStats } from './game-player-stats.js';

// ... inside the tx, before `return { ... };`
await applyTradeStats(tx as Db, {
  gamePlayerId,
  direction,
  symbol,
  quantity,
  price,
});
if (direction === 'sell') {
  await applyPositionCloseStats(tx as Db, {
    gamePlayerId,
    realizedPnl,
    realizedPnlPct,
    holdDurationMs,
  });
}
```

- [ ] **Step 5: Count `distinctSymbols` and return the result struct**

After the tx, query `portfolios` for the player to count symbols with qty > 0:

```ts
const symbolsAfter = await db
  .select({ id: schema.portfolios.id })
  .from(schema.portfolios)
  .where(eq(schema.portfolios.gamePlayerId, gamePlayerId));
const distinctSymbols = symbolsAfter.length;
return { trade, realizedPnl, realizedPnlPct, holdDurationMs, fullyClosed, distinctSymbols };
```

- [ ] **Step 6: Update all callers to destructure `.trade`**

Run `grep -rn "executeTrade(" packages/server/src/` to find every caller. For each call site:
- `packages/server/src/routes/trading.ts`
- `packages/server/src/routes/admin/trades.ts`
- `packages/server/src/workers/pending-orders.ts`
- `packages/server/src/services/working-order.ts` (if it calls)
- `packages/server/src/services/pending-trade.ts` (if it calls)

Replace `const trade = await executeTrade(...)` with `const { trade } = await executeTrade(...)`. Where the result fields are needed (Tasks 9 and 10), keep the full destructure.

- [ ] **Step 7: Run server tests**

Run: `pnpm --filter server test`
Expected: existing tests pass. (New emit logic isn't wired yet — that's Task 9–11. Any breakage here is from callers not being updated; fix it.)

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/services/trade.ts packages/server/src/routes/trading.ts packages/server/src/routes/admin/trades.ts packages/server/src/workers/pending-orders.ts packages/server/src/services/working-order.ts packages/server/src/services/pending-trade.ts
git commit -m "feat(trade): executeTrade tracks openedAt, updates stats, returns derived metrics"
```

---

### Task 9: Emit `position.closed` and `holdings.changed` from `routes/trading.ts`

**Files:**
- Modify: `packages/server/src/routes/trading.ts`

- [ ] **Step 1: Find the existing emit site**

`grep -n "trade.executed" packages/server/src/routes/trading.ts` → around line 368.

- [ ] **Step 2: After the existing emit, also emit the two new events**

Right after the `void bus.emit({ type: 'trade.executed', ... })`:

```ts
const totalPortfolioValue = result.distinctSymbols === 0
  ? cashAfter
  : await computeTotalPortfolioValue(db, gamePlayerId, priceProvider);
// ^ helper exists at services/portfolio.ts; if not, compute inline:
//   sum(quantity × currentPrice) + cashAfter. Re-read services/portfolio.ts
//   to confirm — this plan assumes a `getPortfolioValue(db, gamePlayerId)`
//   helper exists or can be added.
const cashAfterValue = /* cashBalance after trade — already known from the trade row */ ;
const topSymbolValue = result.distinctSymbols === 0 ? 0 : await getTopSymbolValue(db, gamePlayerId, priceProvider);
const topConcentrationRatio = totalPortfolioValue > 0 ? topSymbolValue / totalPortfolioValue : 0;
const cashRatio = totalPortfolioValue > 0 ? cashAfterValue / totalPortfolioValue : 0;

void bus.emit({
  type: 'holdings.changed',
  gameId,
  gamePlayerId,
  distinctSymbols: result.distinctSymbols,
  topConcentrationRatio,
  cashRatio,
  changedAt: trade.executedAt!,
});

if (direction === 'sell') {
  void bus.emit({
    type: 'position.closed',
    gameId,
    gamePlayerId,
    symbol,
    quantity,
    realizedPnl: result.realizedPnl,
    realizedPnlPct: result.realizedPnlPct,
    holdDurationMs: result.holdDurationMs,
    fullyClosed: result.fullyClosed,
    closedAt: trade.executedAt!,
  });
}
```

**Important:** if `getPortfolioValue` / `getTopSymbolValue` helpers don't exist in `services/portfolio.ts`, add them as part of this task (small functions, ≤15 lines each). Use the project's existing pattern for fetching current prices (likely via `priceProvider.getQuote(symbol)` per holding). Re-read `services/portfolio.ts` first to confirm.

- [ ] **Step 3: Typecheck + tests**

Run: `pnpm --filter server typecheck && pnpm --filter server test`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/routes/trading.ts packages/server/src/services/portfolio.ts
git commit -m "feat(events): emit position.closed and holdings.changed from trading route"
```

---

### Task 10: Emit the two new events from admin trade route and pending-orders worker

**Files:**
- Modify: `packages/server/src/routes/admin/trades.ts`
- Modify: `packages/server/src/workers/pending-orders.ts`

- [ ] **Step 1: Mirror the Task 9 emit pattern in both files**

For each of the two existing `bus.emit({ type: 'trade.executed', ... })` sites, add the same two follow-on emits as in Task 9. Extract the common emit logic into a small helper if you find yourself copy-pasting >10 lines:

```ts
// packages/server/src/services/trade-emit.ts
import type { EventBus } from '../events/bus.js';
import type { ExecuteTradeResult } from './trade.js';

export interface EmitTradeEventsParams {
  bus: EventBus;
  gameId: string;
  gamePlayerId: string;
  symbol: string;
  direction: 'buy' | 'sell';
  quantity: number;
  result: ExecuteTradeResult;
  totalPortfolioValue: number;
  cashAfter: number;
  topSymbolValue: number;
  executedAt: string;
}

export function emitTradeEvents(p: EmitTradeEventsParams): void {
  p.bus.emit({ type: 'trade.executed', /* fields from p */ }).catch(() => {}); // existing emit moves here
  p.bus.emit({
    type: 'holdings.changed',
    gameId: p.gameId,
    gamePlayerId: p.gamePlayerId,
    distinctSymbols: p.result.distinctSymbols,
    topConcentrationRatio: p.totalPortfolioValue > 0 ? p.topSymbolValue / p.totalPortfolioValue : 0,
    cashRatio: p.totalPortfolioValue > 0 ? p.cashAfter / p.totalPortfolioValue : 0,
    changedAt: p.executedAt,
  }).catch(() => {});
  if (p.direction === 'sell') {
    p.bus.emit({
      type: 'position.closed',
      gameId: p.gameId,
      gamePlayerId: p.gamePlayerId,
      symbol: p.symbol,
      quantity: p.quantity,
      realizedPnl: p.result.realizedPnl,
      realizedPnlPct: p.result.realizedPnlPct,
      holdDurationMs: p.result.holdDurationMs,
      fullyClosed: p.result.fullyClosed,
      closedAt: p.executedAt,
    }).catch(() => {});
  }
}
```

Then update all three call sites (`routes/trading.ts`, `routes/admin/trades.ts`, `workers/pending-orders.ts`) to call `emitTradeEvents(...)` instead of constructing the emits inline. This is a small refactor of Task 9.

- [ ] **Step 2: Add a `// TODO(achievements):` note in `docs/design.md` about resting-sell P&L**

Open `docs/design.md`, find the section on trades or achievements, and append:

```markdown
### Known gap: resting-sell realized P&L

For limit/stop sell orders that fill via the trigger worker, the portfolio row
is decremented at *placement*, not fill. The current `applyPositionCloseStats`
path emits `realizedPnl: 0` for these because the cost basis isn't carried
through to the fill. This means achievements like Moonshot / Ten-Bagger /
Bag Holder will not fire on resting-sell fills. Acceptable for now; revisit
when resting orders are more heavily used.
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter server test`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/routes/admin/trades.ts packages/server/src/workers/pending-orders.ts packages/server/src/services/trade-emit.ts docs/design.md
git commit -m "feat(events): emit position.closed + holdings.changed from admin + pending-orders paths"
```

---

### Task 11: Update `portfolio-snapshot.ts` to call `applySnapshotStats` inside the tx

**Files:**
- Modify: `packages/server/src/services/portfolio-snapshot.ts`

- [ ] **Step 1: Re-read the file to locate the snapshot-insert transaction**

Open `services/portfolio-snapshot.ts` and find where snapshots are written and the `snapshot.recorded` event is emitted (around line 62).

- [ ] **Step 2: Import and call `applySnapshotStats` inside the same tx, per player**

Add inside the snapshot transaction loop:

```ts
import { applySnapshotStats } from './game-player-stats.js';

// for each player snapshot computed:
await applySnapshotStats(tx as Db, {
  gamePlayerId,
  totalValue,
  rank,
  totalPlayers,
  capturedAt,
});
```

- [ ] **Step 3: Add an integration test**

Create `packages/server/tests/services/portfolio-snapshot-stats.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { schema } from '../../src/db/index.js';
import { eq } from 'drizzle-orm';
// Reuse the existing snapshot test harness. Re-read tests/services/portfolio-snapshot.test.ts
// for the helper that recordSnapshotsForGame uses.

describe('recordSnapshotsForGame side-effects on game_player_stats', () => {
  it('writes peak, trough, lastRank for each player', async () => {
    // arrange: seed game + 2 players + initial cash
    // act: call recordSnapshotsForGame
    // assert: gamePlayerStats rows exist with correct peak/lastRank
  });
});
```

Fill in the harness usage by mirroring `tests/services/portfolio-snapshot.test.ts`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter server test -- tests/services/portfolio-snapshot-stats.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/portfolio-snapshot.ts packages/server/tests/services/portfolio-snapshot-stats.test.ts
git commit -m "feat(snapshot): update game_player_stats inside snapshot transaction"
```

---

## Phase 4 — Engine Plumbing

### Task 12: Teach `engine.gameIdOf` about the two new events

**Files:**
- Modify: `packages/server/src/achievements/engine.ts`

- [ ] **Step 1: Extend `gameIdOf`**

Around line 15 in `engine.ts`, extend the chain to include `position.closed` and `holdings.changed`:

```ts
function gameIdOf(event: DomainEvent): string | null {
  switch (event.type) {
    case 'engine.tick':
      return null;
    case 'game.ended':
    case 'game.started':
    case 'player.joined':
    case 'snapshot.recorded':
    case 'trade.executed':
    case 'position.closed':
    case 'holdings.changed':
      return event.gameId;
  }
}
```

(Rewriting as a switch is cleaner than extending the nested ternary; both reach the same result.)

- [ ] **Step 2: Test**

Add a small case to `packages/server/tests/achievements/engine.test.ts` asserting that an achievement subscribing to `position.closed` receives an event with the correct gameId scoping. Mirror the existing test pattern.

- [ ] **Step 3: Run tests**

Run: `pnpm --filter server test -- tests/achievements/engine.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/achievements/engine.ts packages/server/tests/achievements/engine.test.ts
git commit -m "feat(achievements): engine scopes position.closed and holdings.changed by gameId"
```

---

## Phase 5 — Achievement Definitions

Each task in this phase follows the same pattern:

1. Write the failing test (a small file under `tests/achievements/definitions/<key>.test.ts`).
2. Run to confirm failure.
3. Create the definition file under `src/achievements/definitions/<key>.ts`.
4. Add it to the registry in `definitions/index.ts`.
5. Run the test to confirm pass.
6. Commit.

For brevity, the template appears once. **Use the template verbatim for every achievement**, substituting the per-achievement code shown in the table at the end of this phase.

### Definition Task Template

````markdown
### Task N: Achievement `<key>` (`<name>`)

**Files:**
- Create: `packages/server/src/achievements/definitions/<key>.ts`
- Test: `packages/server/tests/achievements/definitions/<key>.test.ts`
- Modify: `packages/server/src/achievements/definitions/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import definition from '../../../src/achievements/definitions/<key>.js';

describe('achievement: <key>', () => {
  let h: Awaited<ReturnType<typeof makeAchievementHarness>>;
  beforeEach(async () => { h = await makeAchievementHarness(definition); });

  it('unlocks when <trigger condition>', async () => {
    await h.dispatch(/* event payload */);
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock when <negative case>', async () => {
    await h.dispatch(/* event that should NOT trigger unlock */);
    expect(await h.isUnlocked()).toBe(false);
  });
});
```

**Helper note:** create `tests/helpers/achievement-harness.ts` once (Task 13a below) and reuse it for every definition test.

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter server test -- tests/achievements/definitions/<key>.test.ts`
Expected: FAIL.

- [ ] **Step 3: Create the definition**

```ts
import { defineAchievement } from '../define.js';
export default defineAchievement({
  key: '<key>',
  name: '<name>',
  description: '<description>',
  rarity: '<rarity>',
  icon: '<icon>',
  category: '<category>',
  target: <target>,
  events: [/* events */],
  async onEvent(event, ctx) {
    // logic
  },
});
```

- [ ] **Step 4: Register**

In `definitions/index.ts` add the import + push into the array.

- [ ] **Step 5: Run test to pass**

Run: `pnpm --filter server test -- tests/achievements/definitions/<key>.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/achievements/definitions/<key>.ts packages/server/tests/achievements/definitions/<key>.test.ts packages/server/src/achievements/definitions/index.ts
git commit -m "feat(achievements): add <key> achievement"
```
````

---

### Task 13a: Create reusable achievement test harness

**Files:**
- Create: `packages/server/tests/helpers/achievement-harness.ts`

- [ ] **Step 1: Implement the harness**

```ts
import { eq, and } from 'drizzle-orm';
import { schema } from '../../src/db/index.js';
import { AchievementEngine } from '../../src/achievements/engine.js';
import { EventBus } from '../../src/events/bus.js';
import { SystemSettingsService } from '../../src/services/system-settings.js';
import type { AnyAchievementDefinition } from '../../src/achievements/define.js';
import type { DomainEvent } from '../../src/events/types.js';
// Reuse existing test DB + game/user/player seeding helpers. Re-read
// tests/achievements/engine.test.ts for the existing setup pattern and copy
// the in-memory DB + seed helpers into this file (or re-export them).

export async function makeAchievementHarness(def: AnyAchievementDefinition) {
  // 1. Create in-memory db + run migrations.
  // 2. Seed: user, game (with achievementsEnabled=true), game_player.
  // 3. Construct EventBus, fake GameClientRegistry (in-memory broadcast store),
  //    SystemSettingsService, AchievementEngine([def]).
  // 4. engine.start().
  // 5. Return { db, dispatch, isUnlocked, gameId, gamePlayerId, broadcasts }.
  // — dispatch(event: DomainEvent): emits via bus and awaits handler settle.
  // — isUnlocked(): reads achievement_progress and returns unlocked_at != null.
}
```

Fill in the helpers by mirroring `tests/achievements/engine.test.ts`. This is the one place where "look at the existing tests for the pattern" is reasonable because the engine test already encodes everything needed.

- [ ] **Step 2: Smoke-test the harness with the existing `first-trade` definition**

```ts
// at bottom of achievement-harness.ts or a new tests/helpers/achievement-harness.smoke.test.ts
import firstTrade from '../../src/achievements/definitions/first-trade.js';
import { describe, it, expect } from 'vitest';

describe('achievement-harness smoke', () => {
  it('unlocks first-trade on a trade.executed event', async () => {
    const h = await makeAchievementHarness(firstTrade);
    await h.dispatch({
      type: 'trade.executed',
      gameId: h.gameId,
      gamePlayerId: h.gamePlayerId,
      symbol: 'AAPL',
      direction: 'buy',
      quantity: 1,
      price: 100,
      tradeId: 'test-trade',
      executedAt: new Date().toISOString(),
    });
    expect(await h.isUnlocked()).toBe(true);
  });
});
```

- [ ] **Step 3: Run smoke test**

Run: `pnpm --filter server test -- tests/helpers/achievement-harness.smoke.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/server/tests/helpers/achievement-harness.ts packages/server/tests/helpers/achievement-harness.smoke.test.ts
git commit -m "test(achievements): reusable harness for definition tests"
```

---

### Definition Catalog

Apply the template above for each row. Suggested icon names are starting points — change if a better Lucide icon fits. `target` is `1` for boolean unlocks, otherwise the listed count. Handler pseudocode is shown inline; expand to real TypeScript matching the patterns in `first-trade.ts`, `ten-buys.ts`, and `rock-bottom.ts`.

| # | Task | Key | Name | Cat | Rarity | Target | Events | Icon | Handler (pseudo) |
|---|---|---|---|---|---|---|---|---|---|
| 14 | T14 | `apprentice` | Apprentice | trading | common | 12 | `trade.executed` | `dumbbell` | `ctx.increment(gpId, 1)` |
| 15 | T15 | `day-trader` | Day Trader | trading | uncommon | 25 | `trade.executed` | `activity` | `ctx.increment(gpId, 1)` |
| 16 | T16 | `market-maker` | Market Maker | trading | rare | 50 | `trade.executed` | `briefcase` | `ctx.increment(gpId, 1)` |
| 17 | T17 | `first-sale` | First Sale | trading | common | 1 | `trade.executed` | `tag` | `if (direction==='sell') ctx.unlock(gpId)` |
| 18 | T18 | `sampler` | Sampler | trading | common | 5 | `trade.executed` | `shapes` | read `stats.distinctSymbolsTradedEver`; `ctx.setProgress(gpId, stats.distinctSymbolsTradedEver)` |
| 19 | T19 | `globe-trotter` | Globe Trotter | trading | uncommon | 15 | `trade.executed` | `globe` | same pattern, target 15 |
| 20 | T20 | `first-blood` | First Blood | pnl | common | 1 | `position.closed` | `droplet` | `if (realizedPnl > 0) ctx.unlock(gpId)` |
| 21 | T21 | `green-streak` | Green Streak | pnl | uncommon | 5 | `position.closed` | `trending-up` | read `stats.consecutiveWins`; `ctx.setProgress(gpId, stats.consecutiveWins)` |
| 22 | T22 | `moonshot` | Moonshot | pnl | rare | 1 | `position.closed` | `rocket` | `if (realizedPnlPct >= 0.5) ctx.unlock(gpId)` |
| 23 | T23 | `ten-bagger` | Ten-Bagger | pnl | legendary | 1 | `position.closed` | `gem` | `if (realizedPnlPct >= 9.0) ctx.unlock(gpId)` (10× = +900%) |
| 24 | T24 | `bag-holder` | Bag Holder | pnl | uncommon | 1 | `position.closed` | `package` | `if (realizedPnlPct <= -0.5) ctx.unlock(gpId)` |
| 25 | T25 | `catastrophe` | Catastrophe | pnl | rare | 1 | `position.closed` | `flame` | `if (realizedPnlPct <= -0.9) ctx.unlock(gpId)` |
| 26 | T26 | `double-up` | Double Up | pnl | epic | 1 | `snapshot.recorded` | `arrow-up` | fetch `game.startingBalance` via `ctx.db`; `if (totalValue >= 2*startingBalance) ctx.unlock(gpId)` |
| 27 | T27 | `triple-threat` | Triple Threat | pnl | legendary | 1 | `snapshot.recorded` | `crown` | same, `>= 3*startingBalance` |
| 28 | T28 | `underwater` | Underwater | pnl | uncommon | 1 | `snapshot.recorded` | `waves` | `if (totalValue <= 0.5*startingBalance) ctx.unlock(gpId)` |
| 29 | T29 | `phoenix` | Phoenix | pnl | rare | 1 | `snapshot.recorded` | `feather` | read `stats.troughPortfolioValue`; `if (stats.troughPortfolioValue !== null && stats.troughPortfolioValue <= 0.75*startingBalance && totalValue >= startingBalance) ctx.unlock(gpId)` |
| 30 | T30 | `locked-in` | Locked In | pnl | uncommon | 1 | `position.closed` | `lock` | read `stats.realizedPnl`; `if (stats.realizedPnl >= 0.25*startingBalance) ctx.unlock(gpId)` |
| 31 | T31 | `wolf-of-markettrader` | Wolf of MarketTrader | pnl | epic | 1 | `position.closed` | `wolf` (fallback `medal`) | same, `>= 1.0*startingBalance` |
| 32 | T32 | `diversified` | Diversified | portfolio | uncommon | 1 | `holdings.changed` | `pie-chart` | `if (distinctSymbols >= 10) ctx.unlock(gpId)` |
| 33 | T33 | `index-fund` | Index Fund | portfolio | rare | 1 | `holdings.changed` | `layout-grid` | `if (distinctSymbols >= 20) ctx.unlock(gpId)` |
| 34 | T34 | `all-in` | All In | portfolio | uncommon | 1 | `holdings.changed` | `target` | `if (topConcentrationRatio >= 0.9) ctx.unlock(gpId)` |
| 35 | T35 | `cash-is-king` | Cash Is King | portfolio | uncommon | 1 | `holdings.changed` | `banknote` | read `stats.distinctSymbolsTradedEver`; `if (distinctSymbols === 0 && stats.distinctSymbolsTradedEver >= 5) ctx.unlock(gpId)` |
| 36 | T36 | `fully-invested` | Fully Invested | portfolio | common | 1 | `holdings.changed` | `piggy-bank` | `if (cashRatio <= 0.01 && distinctSymbols > 0) ctx.unlock(gpId)` |
| 37 | T37 | `concentrated-bet` | Concentrated Bet | portfolio | uncommon | 1 | `trade.executed` | `crosshair` | `if (direction==='buy')` lookup player's `cashBalance` from `gamePlayers` row BEFORE the trade was applied (cashBalance + price*quantity = cashBefore); `if (price*quantity >= 0.5*cashBefore) ctx.unlock(gpId)` |
| 38 | T38 | `top-of-the-class` | Top of the Class | standing | common | 1 | `snapshot.recorded` | `award` | `if (rank === 1) ctx.unlock(gpId)` |
| 39 | T39 | `reigning-champ` | Reigning Champ | standing | rare | 3 | `snapshot.recorded` | `star` | read `stats.consecutiveDaysAtRankOne`; `ctx.setProgress(gpId, stats.consecutiveDaysAtRankOne)` |
| 40 | T40 | `untouchable` | Untouchable | standing | epic | 7 | `snapshot.recorded` | `shield` | same pattern with `stats.daysAtRankOne` |
| 41 | T41 | `podium-days` | Podium | standing | uncommon | 5 | `snapshot.recorded` | `medal` | same with `stats.daysInTopThree` |
| 42 | T42 | `above-average` | Above Average | standing | uncommon | 7 | `snapshot.recorded` | `chart-line` | same with `stats.consecutiveDaysAtOrAboveMedian` |
| 43 | T43 | `comeback-kid` | Comeback Kid | standing | rare | 1 | `snapshot.recorded` | `arrow-up-from-line` | read `stats.lastDayRank` (the rank from the prior day, set in applySnapshotStats *before* the same-tx update via the stored value); `if (lastDayRank !== null && lastDayRank - rank >= 3) ctx.unlock(gpId)` |
| 44 | T44 | `free-fall` | Free Fall | standing | uncommon | 1 | `snapshot.recorded` | `arrow-down-from-line` | `if (lastDayRank !== null && rank - lastDayRank >= 3) ctx.unlock(gpId)` |
| 45 | T45 | `paper-hands` | Paper Hands | behavior | common | 1 | `position.closed` | `feather` | `if (holdDurationMs < 5*60*1000) ctx.unlock(gpId)` |
| 46 | T46 | `diamond-hands` | Diamond Hands | behavior | rare | 1 | `position.closed` | `diamond` | `if (holdDurationMs >= 7*24*60*60*1000) ctx.unlock(gpId)` |
| 47 | T47 | `revenge-trade` | Revenge Trade | behavior | uncommon | 1 | `trade.executed` | `swords` | `if (direction==='buy')` query trades for `(gamePlayerId, symbol, direction='sell', executedAt within last hour)`; if any such trade exists AND was a loss (look at the prior trade history to confirm: avgCostBasis at that time > sellPrice — simpler: store the loss flag on the trade. For v1, just check "sold same symbol in last hour" and call it a revenge trade — note this in the description). `ctx.unlock(gpId)`. **Simplification accepted:** the loss check is omitted in v1; the achievement description should read "Re-buy a symbol within 1 hour of selling it." Update spec/code to match. |
| 48 | T48 | `fomo` | FOMO | behavior | rare | 1 | `trade.executed` | `flame` | `if (direction==='buy')` query `portfolios` rows in this game with this symbol, ordered by `openedAt` ascending; if the earliest belongs to another player and `openedAt` is within the last 5 minutes, `ctx.unlock(gpId)`. Skip if the player themselves is the first holder. |
| 49 | T49 | `champion` | Champion | finale | epic | 1 | `game.ended` | `trophy` | iterate `event.finalRanking`; for each entry with `rank===1`, `ctx.unlock(entry.gamePlayerId)` |
| 50 | T50 | `podium-finish` | Podium Finish | finale | rare | 1 | `game.ended` | `medal` | for each entry with `rank<=3`, `ctx.unlock(entry.gamePlayerId)` |
| 51 | T51 | `honourable-mention` | Honourable Mention | finale | common | 1 | `game.ended` | `bookmark` | `if (finalRanking.length >= 4)` for each entry with `rank <= floor(finalRanking.length/2)`, `ctx.unlock(entry.gamePlayerId)` |
| 52 | T52 | `wooden-spoon` | Wooden Spoon | finale | uncommon | 1 | `game.ended` | `utensils` | `if (finalRanking.length >= 3)` find the entry with the maximum rank; `ctx.unlock(entry.gamePlayerId)` |
| 53 | T53 | `wire-to-wire` | Wire to Wire | finale | legendary | 1 | `game.ended` | `flag` | for each entry with `rank===1`, query `portfolio_snapshots` for the earliest snapshot for that player in the game; if its `rank === 1`, `ctx.unlock(entry.gamePlayerId)` |

---

### Task 54: Migrate `rock-bottom` to day-based semantics

**Files:**
- Modify: `packages/server/src/achievements/definitions/rock-bottom.ts`
- Modify: `packages/server/tests/achievements/definitions/rock-bottom.test.ts` (already exists; update)

- [ ] **Step 1: Rewrite the definition**

```ts
import { defineAchievement } from '../define.js';
import { eq } from 'drizzle-orm';
import { schema } from '../../db/index.js';

/** Day-based: last place on the leaderboard for 3 consecutive UTC days. */
export default defineAchievement({
  key: 'rock-bottom',
  name: 'Rock Bottom',
  description: 'Be last on the leaderboard for 3 days in a row.',
  rarity: 'epic',
  icon: 'trending-down',
  category: 'standing',
  target: 3,
  events: ['snapshot.recorded'],
  async onEvent(event, ctx) {
    if (event.totalPlayers <= 1) return;
    const [stats] = await ctx.db
      .select({ consec: schema.gamePlayerStats.consecutiveDaysInLastPlace })
      .from(schema.gamePlayerStats)
      .where(eq(schema.gamePlayerStats.gamePlayerId, event.gamePlayerId))
      .limit(1);
    if (!stats) return;
    await ctx.setProgress(event.gamePlayerId, stats.consec);
  },
});
```

- [ ] **Step 2: Update the test**

Rewrite `packages/server/tests/achievements/definitions/rock-bottom.test.ts` to drive `snapshot.recorded` events across day boundaries and assert that `progress` advances only on day rollover, and unlocks after 3 consecutive days at last place.

- [ ] **Step 3: Add a one-shot migration for in-progress rows**

Create `packages/server/drizzle/<timestamp>_reset_rock_bottom_progress.sql`:

```sql
UPDATE achievement_progress
SET progress = 0, target = 3
WHERE achievement_key = 'rock-bottom' AND unlocked_at IS NULL;
```

Generate via `pnpm --filter server db:generate` if Drizzle supports a custom SQL file, otherwise add by hand under `drizzle/` and bump the journal manually using the existing migration convention. Re-read `packages/server/drizzle/meta/_journal.json` to confirm the convention.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter server test -- tests/achievements/definitions/rock-bottom.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/achievements/definitions/rock-bottom.ts packages/server/tests/achievements/definitions/rock-bottom.test.ts packages/server/drizzle/
git commit -m "feat(achievements): migrate rock-bottom to day-based semantics"
```

---

## Phase 6 — Frontend Category Labels & Smoke Test

### Task 55: Surface new category labels in the achievement UI

**Files:**
- Modify: wherever the achievement grid renders category headers (likely `packages/frontend/src/components/achievements/AchievementGrid.tsx` or `AchievementRoster.tsx`)

- [ ] **Step 1: Locate the category label map**

Run: `grep -rn "category\|trading\|standing" packages/frontend/src/components/achievements/`

Find the existing label map (or label-as-is fallback). Extend it to include the new categories:

```ts
const CATEGORY_LABELS: Record<string, string> = {
  trading: 'Trading',
  pnl: 'P&L',
  portfolio: 'Portfolio',
  standing: 'Standing',
  behavior: 'Behavior',
  finale: 'Finale',
};
```

- [ ] **Step 2: Verify the grid handles all six**

Add or extend a frontend test (vitest) under `packages/frontend/tests/components/achievements/AchievementGrid.test.tsx`:

```ts
it('groups achievements by category and renders all 6 category headers', () => {
  // render with mock data covering all 6 categories; assert each header text appears
});
```

- [ ] **Step 3: Run frontend tests**

Run: `pnpm --filter frontend test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/components/achievements/ packages/frontend/tests/components/achievements/
git commit -m "feat(ui): render new achievement categories (pnl, portfolio, behavior, finale)"
```

---

## Phase 7 — Final Verification

### Task 56: End-to-end smoke and full test pass

- [ ] **Step 1: Run all server tests**

Run: `pnpm --filter server test`
Expected: PASS, no skipped achievement tests.

- [ ] **Step 2: Run all frontend tests**

Run: `pnpm --filter frontend test`
Expected: PASS.

- [ ] **Step 3: Run typecheck and lint at the root**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Launch the dev server and exercise the path manually**

```bash
pnpm dev
```

- Create a game with 2+ players, achievementsEnabled=true.
- Execute trades to trigger 3–5 of the new achievements (e.g. Apprentice via 12 trades, First Sale, Moonshot via a 50% gainer if possible).
- Confirm the toast fires and the achievement appears in the roster, grouped under the correct category.

- [ ] **Step 5: Final commit (if any docs touched during smoke)**

```bash
git add -A
git commit -m "chore(achievements): final smoke and doc tidy" --allow-empty
```

---

## Self-Review Notes (Pre-Execution)

This plan was self-reviewed against the spec; the following clarifications are noted:

1. **Resting-sell P&L** (Task 8 step 3): the closed-out portfolio row is gone by the time the trigger worker fills, so realized P&L can't be computed at fill time. v1 emits zero P&L for these. Documented in `docs/design.md` via Task 10 step 2.

2. **Revenge Trade simplification** (Task 47): the spec's description says "after closing it at a loss," but reliably detecting a loss requires looking at the historic cost basis at sell time — extra query against trade history. v1 simplifies to "after selling it within the last hour" and updates the description to match. Captured inline in the definition table.

3. **`computeTotalPortfolioValue` helper** (Task 9 step 2): plan assumes either an existing helper or that the implementer adds a small one inline. The implementer should re-read `services/portfolio.ts` before starting Task 9 — if no helper exists, factor out a `getPortfolioValue(db, gamePlayerId, priceProvider)` as part of that task.

4. **Definition tasks 14–53 are formulaic.** Each follows the same 6-step template (Task 13a/13b pattern). The catalog table specifies the per-achievement parameters; the template specifies the test+commit ritual. Don't skip the test step on any of them — the harness is the cheap part.

5. **Day-rollover semantics edge case** (Task 7): the first ever snapshot only seeds `lastDayCounted` and does NOT advance any day counter. This is intentional — there's no prior day to count for. Confirmed by the test case in Task 7 step 1.

6. **Pyramid rarity skew** (spec §3.7): the final distribution is 9/16/10/5/3, not the strict 14/12/8/4/2 pyramid discussed during brainstorming. The spec called this out as a deliberate choice; no rebalancing in this plan.
