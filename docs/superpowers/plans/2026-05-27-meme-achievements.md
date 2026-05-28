# Meme Achievements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 13 new achievements (a mix of meme-flavored and serious behavior/P&L triggers) and the two supporting infrastructure pieces they depend on (per-day trade counters and a per-holding peak/trough tracker).

**Architecture:** Two new pieces of state. (1) Three columns on `game_player_stats` capture per-UTC-day trade and losing-sell counts; the existing `applyTradeStats` / `applyPositionCloseStats` rollups extend to maintain them. (2) A new `position_high_water` table records per-(player, symbol) peak/trough metrics; the snapshot pipeline (`recordSnapshot` in `services/portfolio-snapshot.ts`) updates marks once per tick using a skip-when-unchanged write, and the trade pipeline (`services/trade.ts`) seeds rows on 0→positive opens and deletes them on full close. Five of the new achievements read from this table on `snapshot.recorded` / `position.closed`; two read the day counters; six only use existing event fields.

**Tech Stack:** Node.js + TypeScript + Fastify v5; Drizzle ORM with parallel SQLite (dev/test) and Postgres (prod) schemas; Vitest for unit tests.

---

## Spec reference

This plan implements `docs/superpowers/specs/2026-05-27-meme-achievements-design.md`. Read that spec first if you need the rationale for any decision; this plan is the executable version.

## File map

**New definition files (all under `packages/server/src/achievements/definitions/`):**
- `buy-high-sell-low.ts`, `dollar-menu.ts`, `one-share-wonder.ts`, `whale.ts`, `penny-stock-enjoyer.ts`, `speedrun-any-percent.ts` (cheap)
- `sir-this-is-a-wendys.ts`, `tax-loss-harvester.ts` (per-day infra)
- `stonks.ts`, `this-is-fine.ts`, `hodl.ts`, `round-tripper.ts`, `diamond-plated-hands.ts` (per-holding infra)
- `index.ts` — register all 13

**Schema changes:**
- `packages/server/src/db/schema.sqlite.ts` — add `tradesUtcDate`, `tradesToday`, `losingSellsToday` to `gamePlayerStats`; add `positionHighWater` table
- `packages/server/src/db/schema.pg.ts` — same changes for Postgres
- Drizzle-generated migrations under `packages/server/src/db/migrations/`

**Service changes:**
- `packages/server/src/services/game-player-stats.ts` — extend `applyTradeStats` and `applyPositionCloseStats` to maintain the day counters
- `packages/server/src/services/position-high-water.ts` (new) — `onPositionOpened`, `onPositionClosed`, `updateMarks`, `getMarks`, `getAllMarks`
- `packages/server/src/services/trade.ts` — call `onPositionOpened` (brand-new position) and `onPositionClosed` (fullyClosed sell) inside the existing trade transaction
- `packages/server/src/services/portfolio-snapshot.ts` — call `updateMarks` per player per tick, right before emitting `snapshot.recorded`

**Test files (all under `packages/server/tests/`):**
- `achievements/definitions/<key>.test.ts` — one per new achievement (13 files)
- `services/position-high-water.test.ts` — service unit tests
- `services/game-player-stats.test.ts` — extended with day-counter cases (may need to be created if it doesn't exist yet)
- `helpers/position-high-water-harness.ts` (new) — direct-seed helper for the five per-holding achievement tests

## Build order

1. Phase A: per-day counter infra + its two consuming achievements
2. Phase B: per-holding peak/trough infra + its five consuming achievements
3. Phase C: the six cheap achievements
4. Phase D: docs regen + final verification

Each task is one commit. The branch is already `feat/achievement-horse`; keep working there.

---

## Phase A — Per-day counters

### Task A1: Add `tradesUtcDate`, `tradesToday`, `losingSellsToday` columns to `gamePlayerStats`

**Files:**
- Modify: `packages/server/src/db/schema.sqlite.ts`
- Modify: `packages/server/src/db/schema.pg.ts`

- [ ] **Step 1: Inspect existing `gamePlayerStats` definition in both schema files**

Read the table block in `packages/server/src/db/schema.sqlite.ts` (search for `export const gamePlayerStats = sqliteTable`) and in `packages/server/src/db/schema.pg.ts` (search for `export const gamePlayerStats = pgTable`).

- [ ] **Step 2: Add three columns to the SQLite schema**

Inside the `gamePlayerStats` block in `schema.sqlite.ts`, add (place them after the existing `realizedPnl` group, before `updatedAt`):

```typescript
  /** UTC calendar day (`YYYY-MM-DD`) the per-day trade counters apply to. Null until first trade. */
  tradesUtcDate: text('trades_utc_date'),
  /** Number of trades executed on `tradesUtcDate`. Resets at UTC day rollover. */
  tradesToday: integer('trades_today').notNull().default(0),
  /** Number of losing closed positions on `tradesUtcDate`. Resets at UTC day rollover. */
  losingSellsToday: integer('losing_sells_today').notNull().default(0),
```

- [ ] **Step 3: Add the matching columns to the Postgres schema**

Same three fields, but using the `pg-core` column constructors that the file already imports. Match the surrounding style (e.g. `text(...)`, `integer(...).notNull().default(0)`).

- [ ] **Step 4: Generate migrations**

Run: `pnpm --filter server db:generate`
Expected: two new migration files (one per dialect) appear under `packages/server/src/db/migrations/`. Inspect them — they should `ALTER TABLE game_player_stats ADD COLUMN ...` for each of the three new columns.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter server typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/db/schema.sqlite.ts packages/server/src/db/schema.pg.ts packages/server/src/db/migrations/
git commit -m "feat(db): add per-day trade and losing-sell counters to gamePlayerStats"
```

### Task A2: Extend `applyTradeStats` to maintain `tradesToday` / `tradesUtcDate`

**Files:**
- Modify: `packages/server/src/services/game-player-stats.ts`
- Test: `packages/server/tests/services/game-player-stats.test.ts` (create if missing)

- [ ] **Step 1: Inspect `applyTradeStats` signature**

Open `packages/server/src/services/game-player-stats.ts` and locate `applyTradeStats`. Confirm it receives an `executedAt` ISO string (if not, you'll need to thread one through from `services/trade.ts` — check the call site in `trade.ts` first; the existing code computes `executedAt` before opening the transaction).

If `executedAt` is not already a parameter, add it: change the signature to accept `executedAt: string` and update the one call site in `trade.ts` to pass it through.

- [ ] **Step 2: Write the failing test for same-day increment**

Create or extend `packages/server/tests/services/game-player-stats.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/app.js';
import * as schema from '../../src/db/schema.sqlite.js';
import { applyTradeStats } from '../../src/services/game-player-stats.js';
import type { Db } from '../../src/db/index.js';

async function seedPlayer(db: Db): Promise<string> {
  const [u] = await db
    .insert(schema.users)
    .values({ username: `u-${Math.random().toString(36).slice(2)}`, passwordHash: 'x' })
    .returning();
  const [g] = await db
    .insert(schema.games)
    .values({
      name: 'g',
      startDate: '2020-01-01T00:00:00.000Z',
      endDate: '2099-01-01T00:00:00.000Z',
      startingBalance: 10000,
      createdBy: u!.id,
    })
    .returning();
  const [gp] = await db
    .insert(schema.gamePlayers)
    .values({ gameId: g!.id, userId: u!.id, cashBalance: 10000 })
    .returning();
  return gp!.id;
}

async function readStats(db: Db, gamePlayerId: string) {
  const [row] = await db
    .select()
    .from(schema.gamePlayerStats)
    .where(eq(schema.gamePlayerStats.gamePlayerId, gamePlayerId));
  return row;
}

describe('applyTradeStats per-day counters', () => {
  let db: Db;
  beforeEach(async () => {
    db = (await createTestDb()) as unknown as Db;
  });

  it('increments tradesToday for trades on the same UTC day', async () => {
    const gpid = await seedPlayer(db);
    await applyTradeStats(db, { gamePlayerId: gpid, direction: 'buy', symbol: 'AAPL', quantity: 1, price: 100, executedAt: '2026-05-27T01:00:00.000Z' });
    await applyTradeStats(db, { gamePlayerId: gpid, direction: 'buy', symbol: 'AAPL', quantity: 1, price: 100, executedAt: '2026-05-27T22:00:00.000Z' });
    const stats = await readStats(db, gpid);
    expect(stats?.tradesUtcDate).toBe('2026-05-27');
    expect(stats?.tradesToday).toBe(2);
  });
});
```

- [ ] **Step 3: Run test, confirm it fails**

Run: `pnpm --filter server test -- --run tests/services/game-player-stats.test.ts`
Expected: FAIL (`tradesToday` is `0`, or column doesn't exist if migration wasn't applied — `createTestDb` applies migrations automatically).

- [ ] **Step 4: Implement same-day increment**

In `applyTradeStats`, after the existing counter updates and before returning, add:

```typescript
  const utcDay = executedAt.slice(0, 10);
  // Same-day update path. If `tradesUtcDate` is null or differs, the rollover
  // branch below handles it instead.
  await db
    .update(schema.gamePlayerStats)
    .set({ tradesToday: sql`${schema.gamePlayerStats.tradesToday} + 1` })
    .where(
      and(
        eq(schema.gamePlayerStats.gamePlayerId, gamePlayerId),
        eq(schema.gamePlayerStats.tradesUtcDate, utcDay),
      ),
    );
```

Make sure `sql`, `and`, `eq` are imported from `drizzle-orm` at the top of the file.

- [ ] **Step 5: Add the day-rollover test**

Append to the describe block:

```typescript
  it('resets tradesToday on UTC day rollover', async () => {
    const gpid = await seedPlayer(db);
    await applyTradeStats(db, { gamePlayerId: gpid, direction: 'buy', symbol: 'AAPL', quantity: 1, price: 100, executedAt: '2026-05-27T22:00:00.000Z' });
    await applyTradeStats(db, { gamePlayerId: gpid, direction: 'buy', symbol: 'AAPL', quantity: 1, price: 100, executedAt: '2026-05-28T01:00:00.000Z' });
    const stats = await readStats(db, gpid);
    expect(stats?.tradesUtcDate).toBe('2026-05-28');
    expect(stats?.tradesToday).toBe(1);
  });
```

- [ ] **Step 6: Run, confirm rollover test fails**

Run: `pnpm --filter server test -- --run tests/services/game-player-stats.test.ts`
Expected: rollover test FAILs (`tradesToday` is still 0 because the same-day update WHERE clause didn't match — `tradesUtcDate` is null after the first call).

- [ ] **Step 7: Implement the rollover branch**

Replace the snippet from Step 4 with this two-step approach:

```typescript
  const utcDay = executedAt.slice(0, 10);
  // Step 1: same-day increment if the stored date already matches.
  const updated = await db
    .update(schema.gamePlayerStats)
    .set({ tradesToday: sql`${schema.gamePlayerStats.tradesToday} + 1` })
    .where(
      and(
        eq(schema.gamePlayerStats.gamePlayerId, gamePlayerId),
        eq(schema.gamePlayerStats.tradesUtcDate, utcDay),
      ),
    )
    .returning({ id: schema.gamePlayerStats.gamePlayerId });

  // Step 2: rollover (or first-ever trade) — overwrite the date and reset
  // the counter to 1. Runs only when step 1 matched nothing.
  if (updated.length === 0) {
    await db
      .update(schema.gamePlayerStats)
      .set({ tradesUtcDate: utcDay, tradesToday: 1, losingSellsToday: 0 })
      .where(eq(schema.gamePlayerStats.gamePlayerId, gamePlayerId));
  }
```

Note: `losingSellsToday` is reset on rollover here too because a new day means the loss counter for the prior day is no longer relevant. The losing-sell handler in Task A3 will increment it from a known-good zero base.

- [ ] **Step 8: Run, confirm both tests pass**

Run: `pnpm --filter server test -- --run tests/services/game-player-stats.test.ts`
Expected: both PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/server/src/services/game-player-stats.ts packages/server/tests/services/game-player-stats.test.ts packages/server/src/services/trade.ts
git commit -m "feat(stats): track tradesToday with UTC day rollover"
```

(Include `trade.ts` in the commit only if you had to thread `executedAt` through in Step 1.)

### Task A3: Extend `applyPositionCloseStats` to maintain `losingSellsToday`

**Files:**
- Modify: `packages/server/src/services/game-player-stats.ts`
- Test: `packages/server/tests/services/game-player-stats.test.ts`

- [ ] **Step 1: Inspect `applyPositionCloseStats` signature**

Confirm it receives a `closedAt` or `executedAt` ISO string. If not, add it (mirroring Task A2 Step 1) — call site is in `services/trade.ts` next to `applyTradeStats`.

- [ ] **Step 2: Write failing test for losing-sell increment**

Append to the same test file:

```typescript
import { applyPositionCloseStats } from '../../src/services/game-player-stats.js';

describe('applyPositionCloseStats per-day losing sells', () => {
  let db: Db;
  beforeEach(async () => {
    db = (await createTestDb()) as unknown as Db;
  });

  it('increments losingSellsToday only for losing closes', async () => {
    const gpid = await seedPlayer(db);
    await applyPositionCloseStats(db, { gamePlayerId: gpid, realizedPnl: -50, realizedPnlPct: -0.5, holdDurationMs: 60_000, closedAt: '2026-05-27T01:00:00.000Z' });
    await applyPositionCloseStats(db, { gamePlayerId: gpid, realizedPnl: 30, realizedPnlPct: 0.3, holdDurationMs: 60_000, closedAt: '2026-05-27T02:00:00.000Z' });
    await applyPositionCloseStats(db, { gamePlayerId: gpid, realizedPnl: -10, realizedPnlPct: -0.1, holdDurationMs: 60_000, closedAt: '2026-05-27T03:00:00.000Z' });
    const stats = await readStats(db, gpid);
    expect(stats?.tradesUtcDate).toBe('2026-05-27');
    expect(stats?.losingSellsToday).toBe(2);
  });

  it('rolls over losingSellsToday across UTC days', async () => {
    const gpid = await seedPlayer(db);
    await applyPositionCloseStats(db, { gamePlayerId: gpid, realizedPnl: -10, realizedPnlPct: -0.1, holdDurationMs: 60_000, closedAt: '2026-05-27T01:00:00.000Z' });
    await applyPositionCloseStats(db, { gamePlayerId: gpid, realizedPnl: -10, realizedPnlPct: -0.1, holdDurationMs: 60_000, closedAt: '2026-05-28T01:00:00.000Z' });
    const stats = await readStats(db, gpid);
    expect(stats?.tradesUtcDate).toBe('2026-05-28');
    expect(stats?.losingSellsToday).toBe(1);
  });
});
```

- [ ] **Step 3: Run, confirm failures**

Run: `pnpm --filter server test -- --run tests/services/game-player-stats.test.ts`
Expected: the two new tests FAIL.

- [ ] **Step 4: Implement losing-sell rollover + increment**

In `applyPositionCloseStats`, after the existing realized-PnL aggregation, add:

```typescript
  if (realizedPnl < 0) {
    const utcDay = closedAt.slice(0, 10);
    const updated = await db
      .update(schema.gamePlayerStats)
      .set({ losingSellsToday: sql`${schema.gamePlayerStats.losingSellsToday} + 1` })
      .where(
        and(
          eq(schema.gamePlayerStats.gamePlayerId, gamePlayerId),
          eq(schema.gamePlayerStats.tradesUtcDate, utcDay),
        ),
      )
      .returning({ id: schema.gamePlayerStats.gamePlayerId });

    if (updated.length === 0) {
      await db
        .update(schema.gamePlayerStats)
        .set({ tradesUtcDate: utcDay, tradesToday: 0, losingSellsToday: 1 })
        .where(eq(schema.gamePlayerStats.gamePlayerId, gamePlayerId));
    }
  }
```

Note: this rollover branch sets `tradesToday: 0` (not `1`) because no trade is being recorded right now — only the losing close. If a trade event landed first on the new day, A2's rollover branch would have already set `tradesToday: 1` and this branch would never fire.

- [ ] **Step 5: Run, confirm pass**

Run: `pnpm --filter server test -- --run tests/services/game-player-stats.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 6: Run the full server test suite to catch regressions**

Run: `pnpm --filter server test`
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/services/game-player-stats.ts packages/server/tests/services/game-player-stats.test.ts
git commit -m "feat(stats): track losingSellsToday with UTC day rollover"
```

### Task A4: Achievement — Sir, This Is a Wendy's

**Files:**
- Create: `packages/server/src/achievements/definitions/sir-this-is-a-wendys.ts`
- Modify: `packages/server/src/achievements/definitions/index.ts`
- Test: `packages/server/tests/achievements/definitions/sir-this-is-a-wendys.test.ts`

- [ ] **Step 1: Write the definition**

Create `packages/server/src/achievements/definitions/sir-this-is-a-wendys.ts`:

```typescript
import { eq } from 'drizzle-orm';
import { defineAchievement } from '../define.js';
import { schema } from '../../db/index.js';

/**
 * Counter achievement: execute 20 trades in a single UTC day. Reads
 * `game_player_stats.tradesToday`, which the trade-stats rollup
 * maintains with a UTC day-rollover branch.
 */
export default defineAchievement({
  key: 'sir-this-is-a-wendys',
  name: "Sir, This Is a Wendy's",
  description: 'Execute 20 trades in a single UTC day.',
  rarity: 'legendary',
  icon: 'utensils-crossed',
  category: 'trading',
  target: 20,
  events: ['trade.executed'],
  async onEvent(event, ctx) {
    const [stats] = await ctx.db
      .select({ value: schema.gamePlayerStats.tradesToday })
      .from(schema.gamePlayerStats)
      .where(eq(schema.gamePlayerStats.gamePlayerId, event.gamePlayerId))
      .limit(1);
    if (!stats) return;
    await ctx.setProgress(event.gamePlayerId, stats.value);
  },
});
```

- [ ] **Step 2: Register in the definitions index**

In `packages/server/src/achievements/definitions/index.ts`, add the import next to other trading-category imports:

```typescript
import sirThisIsAWendys from './sir-this-is-a-wendys.js';
```

And in the array under `// Trading category`, append after `sixSeven`:

```typescript
  sirThisIsAWendys,
```

- [ ] **Step 3: Write the test**

Create `packages/server/tests/achievements/definitions/sir-this-is-a-wendys.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import sirThisIsAWendys from '../../../src/achievements/definitions/sir-this-is-a-wendys.js';

async function fireTrade(
  h: Awaited<ReturnType<typeof makeAchievementHarness>>,
  executedAt: string,
): Promise<void> {
  await h.dispatch({
    type: 'trade.executed',
    gameId: h.gameId,
    gamePlayerId: h.gamePlayerId,
    symbol: 'AAPL',
    direction: 'buy',
    quantity: 1,
    price: 100,
    tradeId: `t-${Math.random()}`,
    executedAt,
  });
}

describe('achievement: sir-this-is-a-wendys', () => {
  it('unlocks at 20 trades in the same UTC day', async () => {
    const h = await makeAchievementHarness(sirThisIsAWendys);
    for (let i = 0; i < 20; i++) {
      await fireTrade(h, '2026-05-27T12:00:00.000Z');
    }
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock at 19 trades', async () => {
    const h = await makeAchievementHarness(sirThisIsAWendys);
    for (let i = 0; i < 19; i++) {
      await fireTrade(h, '2026-05-27T12:00:00.000Z');
    }
    expect(await h.isUnlocked()).toBe(false);
  });

  it('does not unlock when 20 trades are split across two UTC days', async () => {
    const h = await makeAchievementHarness(sirThisIsAWendys);
    for (let i = 0; i < 15; i++) {
      await fireTrade(h, '2026-05-27T12:00:00.000Z');
    }
    for (let i = 0; i < 15; i++) {
      await fireTrade(h, '2026-05-28T12:00:00.000Z');
    }
    expect(await h.isUnlocked()).toBe(false);
  });
});
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter server test -- --run tests/achievements/definitions/sir-this-is-a-wendys.test.ts`
Expected: all 3 tests PASS. **Important:** this only works if `services/trade.ts` already calls `applyTradeStats` with `executedAt` threaded through (Task A2). The harness's `dispatch` only emits the event — it does NOT call `applyTradeStats`. So you need to additionally have the harness or the test call `applyTradeStats` before dispatching, or update the harness to do so. Inspect the harness; if it doesn't already invoke the stats rollup, add an `applyTradeStats` call directly inside `fireTrade` before `h.dispatch(...)`.

If you need to call it inline, import and call it like:

```typescript
import { applyTradeStats } from '../../../src/services/game-player-stats.js';
// inside fireTrade, before h.dispatch:
await applyTradeStats(h.db, { gamePlayerId: h.gamePlayerId, direction: 'buy', symbol: 'AAPL', quantity: 1, price: 100, executedAt });
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/achievements/definitions/sir-this-is-a-wendys.ts packages/server/src/achievements/definitions/index.ts packages/server/tests/achievements/definitions/sir-this-is-a-wendys.test.ts
git commit -m "feat(achievements): add Sir This Is a Wendy's (20 trades/day)"
```

### Task A5: Achievement — Tax Loss Harvester

**Files:**
- Create: `packages/server/src/achievements/definitions/tax-loss-harvester.ts`
- Modify: `packages/server/src/achievements/definitions/index.ts`
- Test: `packages/server/tests/achievements/definitions/tax-loss-harvester.test.ts`

- [ ] **Step 1: Write the definition**

```typescript
import { eq } from 'drizzle-orm';
import { defineAchievement } from '../define.js';
import { schema } from '../../db/index.js';

/**
 * Counter achievement: close 3 losing positions in a single UTC day.
 * Reads `game_player_stats.losingSellsToday`, maintained by the
 * position-close stats rollup with a UTC day-rollover branch.
 */
export default defineAchievement({
  key: 'tax-loss-harvester',
  name: 'Tax Loss Harvester',
  description: 'Close 3 losing positions in a single UTC day.',
  rarity: 'uncommon',
  icon: 'receipt',
  category: 'trading',
  target: 3,
  events: ['position.closed'],
  async onEvent(event, ctx) {
    if (event.realizedPnl >= 0) return;
    const [stats] = await ctx.db
      .select({ value: schema.gamePlayerStats.losingSellsToday })
      .from(schema.gamePlayerStats)
      .where(eq(schema.gamePlayerStats.gamePlayerId, event.gamePlayerId))
      .limit(1);
    if (!stats) return;
    await ctx.setProgress(event.gamePlayerId, stats.value);
  },
});
```

- [ ] **Step 2: Register in index**

Add the import + array entry in `definitions/index.ts` next to `sirThisIsAWendys`.

- [ ] **Step 3: Write the test**

```typescript
import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import { applyPositionCloseStats } from '../../../src/services/game-player-stats.js';
import taxLossHarvester from '../../../src/achievements/definitions/tax-loss-harvester.js';

async function fireClose(
  h: Awaited<ReturnType<typeof makeAchievementHarness>>,
  realizedPnl: number,
  closedAt: string,
): Promise<void> {
  await applyPositionCloseStats(h.db, {
    gamePlayerId: h.gamePlayerId,
    realizedPnl,
    realizedPnlPct: realizedPnl < 0 ? -0.5 : 0.5,
    holdDurationMs: 60_000,
    closedAt,
  });
  await h.dispatch({
    type: 'position.closed',
    gameId: h.gameId,
    gamePlayerId: h.gamePlayerId,
    symbol: 'AAPL',
    quantity: 1,
    realizedPnl,
    realizedPnlPct: realizedPnl < 0 ? -0.5 : 0.5,
    holdDurationMs: 60_000,
    fullyClosed: true,
    closedAt,
  });
}

describe('achievement: tax-loss-harvester', () => {
  it('unlocks at 3 losing closes in the same UTC day', async () => {
    const h = await makeAchievementHarness(taxLossHarvester);
    await fireClose(h, -10, '2026-05-27T01:00:00.000Z');
    await fireClose(h, -10, '2026-05-27T02:00:00.000Z');
    await fireClose(h, -10, '2026-05-27T03:00:00.000Z');
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not count winning closes', async () => {
    const h = await makeAchievementHarness(taxLossHarvester);
    await fireClose(h, -10, '2026-05-27T01:00:00.000Z');
    await fireClose(h, 10, '2026-05-27T02:00:00.000Z');
    await fireClose(h, -10, '2026-05-27T03:00:00.000Z');
    expect(await h.isUnlocked()).toBe(false);
  });

  it('does not unlock when 3 losses span two UTC days', async () => {
    const h = await makeAchievementHarness(taxLossHarvester);
    await fireClose(h, -10, '2026-05-27T22:00:00.000Z');
    await fireClose(h, -10, '2026-05-28T01:00:00.000Z');
    await fireClose(h, -10, '2026-05-28T02:00:00.000Z');
    expect(await h.isUnlocked()).toBe(false);
  });
});
```

- [ ] **Step 4: Run and commit**

```bash
pnpm --filter server test -- --run tests/achievements/definitions/tax-loss-harvester.test.ts
git add packages/server/src/achievements/definitions/tax-loss-harvester.ts packages/server/src/achievements/definitions/index.ts packages/server/tests/achievements/definitions/tax-loss-harvester.test.ts
git commit -m "feat(achievements): add Tax Loss Harvester (3 losing sells/day)"
```

---

## Phase B — Per-holding peak/trough

### Task B1: Add `positionHighWater` table to schema

**Files:**
- Modify: `packages/server/src/db/schema.sqlite.ts`
- Modify: `packages/server/src/db/schema.pg.ts`

- [ ] **Step 1: Add table to SQLite schema**

Append to `schema.sqlite.ts` (placement: after the existing `gamePlayerStats` definition, before `portfolios` or wherever fits the file's logical grouping):

```typescript
/**
 * Per-(gamePlayerId, symbol) high-water marks since the most recent
 * 0→positive open. Maintained by the snapshot pipeline with a
 * skip-when-unchanged write. Consumed by behaviour/P&L achievements
 * that need peak/trough observation while a position is open.
 */
export const positionHighWater = sqliteTable(
  'position_high_water',
  {
    gamePlayerId: text('game_player_id')
      .notNull()
      .references(() => gamePlayers.id, { onDelete: 'cascade' }),
    symbol: text('symbol').notNull(),
    openedAt: text('opened_at').notNull(),
    peakValue: real('peak_value').notNull(),
    peakPnlPct: real('peak_pnl_pct').notNull(),
    troughPnlPct: real('trough_pnl_pct').notNull(),
    updatedAt: text('updated_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.gamePlayerId, t.symbol] }),
  }),
);
```

Confirm `primaryKey` is imported from `drizzle-orm/sqlite-core` (it's already used elsewhere in the file — search for it; if not present, add it to the existing import list).

- [ ] **Step 2: Add the matching Postgres table**

Same structure, using `pgTable`, `text`, `real`, `primaryKey` from `drizzle-orm/pg-core`. Use `defaultNow()` for `updatedAt` (the PG idiom equivalent of the SQLite `datetime('now')`).

- [ ] **Step 3: Generate migrations**

Run: `pnpm --filter server db:generate`
Inspect the new migration files — they should `CREATE TABLE position_high_water (...)` with the composite primary key.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter server typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/db/schema.sqlite.ts packages/server/src/db/schema.pg.ts packages/server/src/db/migrations/
git commit -m "feat(db): add position_high_water table for per-holding peak/trough"
```

### Task B2: Create `position-high-water` service with open/close hooks

**Files:**
- Create: `packages/server/src/services/position-high-water.ts`
- Test: `packages/server/tests/services/position-high-water.test.ts`

- [ ] **Step 1: Write the test scaffold**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/app.js';
import * as schema from '../../src/db/schema.sqlite.js';
import {
  onPositionOpened,
  onPositionClosed,
  updateMarks,
  getMarks,
  getAllMarks,
} from '../../src/services/position-high-water.js';
import type { Db } from '../../src/db/index.js';

async function seedPlayer(db: Db): Promise<string> {
  const [u] = await db
    .insert(schema.users)
    .values({ username: `u-${Math.random().toString(36).slice(2)}`, passwordHash: 'x' })
    .returning();
  const [g] = await db
    .insert(schema.games)
    .values({
      name: 'g',
      startDate: '2020-01-01T00:00:00.000Z',
      endDate: '2099-01-01T00:00:00.000Z',
      startingBalance: 10000,
      createdBy: u!.id,
    })
    .returning();
  const [gp] = await db
    .insert(schema.gamePlayers)
    .values({ gameId: g!.id, userId: u!.id, cashBalance: 10000 })
    .returning();
  return gp!.id;
}

describe('position-high-water', () => {
  let db: Db;
  beforeEach(async () => {
    db = (await createTestDb()) as unknown as Db;
  });

  it('onPositionOpened seeds peak/trough at the current values', async () => {
    const gpid = await seedPlayer(db);
    await onPositionOpened(db, {
      gamePlayerId: gpid,
      symbol: 'AAPL',
      openedAt: '2026-05-27T00:00:00.000Z',
      currentPrice: 100,
      quantity: 5,
      avgCostBasis: 100,
    });
    const marks = await getMarks(db, gpid, 'AAPL');
    expect(marks).toBeDefined();
    expect(marks!.peakValue).toBe(500);
    expect(marks!.peakPnlPct).toBe(0);
    expect(marks!.troughPnlPct).toBe(0);
    expect(marks!.openedAt).toBe('2026-05-27T00:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run, confirm import failure**

Run: `pnpm --filter server test -- --run tests/services/position-high-water.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create the service file with `onPositionOpened`**

Create `packages/server/src/services/position-high-water.ts`:

```typescript
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';

/** Inputs for {@link onPositionOpened}. */
export interface OnPositionOpenedInput {
  gamePlayerId: string;
  symbol: string;
  openedAt: string;
  currentPrice: number;
  quantity: number;
  avgCostBasis: number;
}

/**
 * Seeds (or re-seeds) the peak/trough marks for a brand-new position.
 * Called from the trade pipeline when a buy takes qty from 0 → positive.
 * Idempotent on the (gamePlayerId, symbol) PK — a second call replaces
 * the prior row, which is the right behaviour for a re-open.
 */
export async function onPositionOpened(db: Db, input: OnPositionOpenedInput): Promise<void> {
  const pnlPct = input.avgCostBasis > 0 ? input.currentPrice / input.avgCostBasis - 1 : 0;
  const value = input.currentPrice * input.quantity;
  await db
    .insert(schema.positionHighWater)
    .values({
      gamePlayerId: input.gamePlayerId,
      symbol: input.symbol,
      openedAt: input.openedAt,
      peakValue: value,
      peakPnlPct: pnlPct,
      troughPnlPct: pnlPct,
    })
    .onConflictDoUpdate({
      target: [schema.positionHighWater.gamePlayerId, schema.positionHighWater.symbol],
      set: {
        openedAt: input.openedAt,
        peakValue: value,
        peakPnlPct: pnlPct,
        troughPnlPct: pnlPct,
      },
    });
}

/** Read helpers used by achievement handlers. */
export async function getMarks(
  db: Db,
  gamePlayerId: string,
  symbol: string,
): Promise<{ openedAt: string; peakValue: number; peakPnlPct: number; troughPnlPct: number } | undefined> {
  const [row] = await db
    .select({
      openedAt: schema.positionHighWater.openedAt,
      peakValue: schema.positionHighWater.peakValue,
      peakPnlPct: schema.positionHighWater.peakPnlPct,
      troughPnlPct: schema.positionHighWater.troughPnlPct,
    })
    .from(schema.positionHighWater)
    .where(
      and(
        eq(schema.positionHighWater.gamePlayerId, gamePlayerId),
        eq(schema.positionHighWater.symbol, symbol),
      ),
    )
    .limit(1);
  return row;
}

export async function getAllMarks(
  db: Db,
  gamePlayerId: string,
): Promise<Array<{ symbol: string; openedAt: string; peakValue: number; peakPnlPct: number; troughPnlPct: number }>> {
  return db
    .select({
      symbol: schema.positionHighWater.symbol,
      openedAt: schema.positionHighWater.openedAt,
      peakValue: schema.positionHighWater.peakValue,
      peakPnlPct: schema.positionHighWater.peakPnlPct,
      troughPnlPct: schema.positionHighWater.troughPnlPct,
    })
    .from(schema.positionHighWater)
    .where(eq(schema.positionHighWater.gamePlayerId, gamePlayerId));
}

/** Removes the row when a position is fully closed. */
export async function onPositionClosed(db: Db, gamePlayerId: string, symbol: string): Promise<void> {
  await db
    .delete(schema.positionHighWater)
    .where(
      and(
        eq(schema.positionHighWater.gamePlayerId, gamePlayerId),
        eq(schema.positionHighWater.symbol, symbol),
      ),
    );
}

/** Inputs to {@link updateMarks} — one row per currently-held symbol. */
export interface MarkUpdateRow {
  symbol: string;
  currentPrice: number;
  quantity: number;
  avgCostBasis: number;
}

/**
 * Per-tick refresh of every open holding's high-water marks. Implements
 * the skip-when-unchanged optimization: a row is only written if the
 * current pnl falls outside the existing band or the current value
 * exceeds the recorded peakValue.
 *
 * Holdings without a pre-existing row (e.g. the row was lost via a
 * race or admin intervention) are reseeded.
 */
export async function updateMarks(
  db: Db,
  gamePlayerId: string,
  holdings: readonly MarkUpdateRow[],
): Promise<void> {
  if (holdings.length === 0) return;
  const existing = await getAllMarks(db, gamePlayerId);
  const existingBySymbol = new Map(existing.map((r) => [r.symbol, r]));

  for (const h of holdings) {
    const pnlPct = h.avgCostBasis > 0 ? h.currentPrice / h.avgCostBasis - 1 : 0;
    const value = h.currentPrice * h.quantity;
    const prev = existingBySymbol.get(h.symbol);

    if (!prev) {
      // No row yet — seed it. Use `now` as openedAt fallback; the trade
      // pipeline normally sets the real openedAt via onPositionOpened.
      await db
        .insert(schema.positionHighWater)
        .values({
          gamePlayerId,
          symbol: h.symbol,
          openedAt: new Date().toISOString(),
          peakValue: value,
          peakPnlPct: pnlPct,
          troughPnlPct: pnlPct,
        })
        .onConflictDoNothing({
          target: [schema.positionHighWater.gamePlayerId, schema.positionHighWater.symbol],
        });
      continue;
    }

    const nextPeakPnl = Math.max(prev.peakPnlPct, pnlPct);
    const nextTroughPnl = Math.min(prev.troughPnlPct, pnlPct);
    const nextPeakValue = Math.max(prev.peakValue, value);
    if (
      nextPeakPnl === prev.peakPnlPct &&
      nextTroughPnl === prev.troughPnlPct &&
      nextPeakValue === prev.peakValue
    ) {
      continue; // skip-when-unchanged
    }
    await db
      .update(schema.positionHighWater)
      .set({
        peakPnlPct: nextPeakPnl,
        troughPnlPct: nextTroughPnl,
        peakValue: nextPeakValue,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(schema.positionHighWater.gamePlayerId, gamePlayerId),
          eq(schema.positionHighWater.symbol, h.symbol),
        ),
      );
  }
}

// inArray import kept available for future bulk operations; suppress unused warning
void inArray;
```

(Remove the trailing `void inArray;` line if your eslint config tolerates unused imports — otherwise keep it.)

- [ ] **Step 4: Run test, confirm `onPositionOpened` test passes**

Run: `pnpm --filter server test -- --run tests/services/position-high-water.test.ts`
Expected: PASS.

- [ ] **Step 5: Write tests for `updateMarks` skip-when-unchanged**

Append:

```typescript
  it('updateMarks raises peak and lowers trough when price moves', async () => {
    const gpid = await seedPlayer(db);
    await onPositionOpened(db, { gamePlayerId: gpid, symbol: 'AAPL', openedAt: '2026-05-27T00:00:00.000Z', currentPrice: 100, quantity: 5, avgCostBasis: 100 });

    await updateMarks(db, gpid, [{ symbol: 'AAPL', currentPrice: 120, quantity: 5, avgCostBasis: 100 }]);
    let marks = await getMarks(db, gpid, 'AAPL');
    expect(marks!.peakPnlPct).toBeCloseTo(0.2);
    expect(marks!.troughPnlPct).toBe(0);
    expect(marks!.peakValue).toBe(600);

    await updateMarks(db, gpid, [{ symbol: 'AAPL', currentPrice: 80, quantity: 5, avgCostBasis: 100 }]);
    marks = await getMarks(db, gpid, 'AAPL');
    expect(marks!.peakPnlPct).toBeCloseTo(0.2);
    expect(marks!.troughPnlPct).toBeCloseTo(-0.2);
    expect(marks!.peakValue).toBe(600);
  });

  it('updateMarks skips the write when nothing changes', async () => {
    const gpid = await seedPlayer(db);
    await onPositionOpened(db, { gamePlayerId: gpid, symbol: 'AAPL', openedAt: '2026-05-27T00:00:00.000Z', currentPrice: 100, quantity: 5, avgCostBasis: 100 });
    await updateMarks(db, gpid, [{ symbol: 'AAPL', currentPrice: 120, quantity: 5, avgCostBasis: 100 }]);
    const before = await getMarks(db, gpid, 'AAPL');

    // Same price as recorded peak → no change to peak/trough/value
    await updateMarks(db, gpid, [{ symbol: 'AAPL', currentPrice: 120, quantity: 5, avgCostBasis: 100 }]);
    const after = await getMarks(db, gpid, 'AAPL');
    // Identity check: the row was not rewritten (updatedAt would have changed if it had).
    // We assert equality on the tracked numeric fields explicitly.
    expect(after).toEqual(before);
  });

  it('onPositionClosed deletes the row', async () => {
    const gpid = await seedPlayer(db);
    await onPositionOpened(db, { gamePlayerId: gpid, symbol: 'AAPL', openedAt: '2026-05-27T00:00:00.000Z', currentPrice: 100, quantity: 5, avgCostBasis: 100 });
    await onPositionClosed(db, gpid, 'AAPL');
    expect(await getMarks(db, gpid, 'AAPL')).toBeUndefined();
  });

  it('re-opening a closed position resets openedAt and seeds fresh marks', async () => {
    const gpid = await seedPlayer(db);
    await onPositionOpened(db, { gamePlayerId: gpid, symbol: 'AAPL', openedAt: '2026-05-27T00:00:00.000Z', currentPrice: 100, quantity: 5, avgCostBasis: 100 });
    await updateMarks(db, gpid, [{ symbol: 'AAPL', currentPrice: 200, quantity: 5, avgCostBasis: 100 }]);
    await onPositionClosed(db, gpid, 'AAPL');
    await onPositionOpened(db, { gamePlayerId: gpid, symbol: 'AAPL', openedAt: '2026-06-01T00:00:00.000Z', currentPrice: 150, quantity: 2, avgCostBasis: 150 });
    const marks = await getMarks(db, gpid, 'AAPL');
    expect(marks!.openedAt).toBe('2026-06-01T00:00:00.000Z');
    expect(marks!.peakPnlPct).toBe(0);
    expect(marks!.troughPnlPct).toBe(0);
    expect(marks!.peakValue).toBe(300);
  });
```

- [ ] **Step 6: Run, confirm all pass**

Run: `pnpm --filter server test -- --run tests/services/position-high-water.test.ts`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/services/position-high-water.ts packages/server/tests/services/position-high-water.test.ts
git commit -m "feat(services): position-high-water tracker with skip-when-unchanged writes"
```

### Task B3: Wire `onPositionOpened` / `onPositionClosed` into the trade pipeline

**Files:**
- Modify: `packages/server/src/services/trade.ts`

- [ ] **Step 1: Locate the brand-new-position branch**

In `services/trade.ts`, find the block (around line 222 in the current file) that handles `direction === 'buy'` when there was no prior `holding`:

```typescript
        // Brand-new position — stamp openedAt so hold-duration metrics work.
        await tx.insert(portfolios).values({ gamePlayerId, symbol, quantity: newQty, avgCostBasis: newAvg, openedAt: executedAt });
```

Right after this insert (still inside the `tx`), add:

```typescript
        await onPositionOpened(tx as unknown as Db, {
          gamePlayerId,
          symbol,
          openedAt: executedAt,
          currentPrice: price,
          quantity: newQty,
          avgCostBasis: newAvg,
        });
```

Import at the top of the file:

```typescript
import { onPositionOpened, onPositionClosed } from './position-high-water.js';
```

- [ ] **Step 2: Locate the full-close branch**

Find the sell branch with `newQty === 0`:

```typescript
      if (newQty === 0) {
        await tx.delete(portfolios).where(...);
```

After the delete (still inside `tx`), add:

```typescript
        await onPositionClosed(tx as unknown as Db, gamePlayerId, symbol);
```

- [ ] **Step 3: Typecheck and run the server suite**

Run: `pnpm --filter server typecheck && pnpm --filter server test`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/services/trade.ts
git commit -m "feat(trade): seed/clear position-high-water marks on open/close"
```

### Task B4: Wire `updateMarks` into the snapshot pipeline

**Files:**
- Modify: `packages/server/src/services/portfolio-snapshot.ts`

- [ ] **Step 1: Add per-player holding lookup before snapshot emit**

In `services/portfolio-snapshot.ts`, after the snapshot insert and the stats `for (const r of rows)` loop, and BEFORE the bus-emit loop, add:

```typescript
  // Refresh per-holding peak/trough marks for every player in the batch.
  // Uses the same cached prices as the leaderboard (no extra provider calls).
  for (const r of rows) {
    const holdings = await db
      .select({
        symbol: schema.portfolios.symbol,
        quantity: schema.portfolios.quantity,
        avgCostBasis: schema.portfolios.avgCostBasis,
        price: schema.stockPriceCache.price,
      })
      .from(schema.portfolios)
      .leftJoin(schema.stockPriceCache, eq(schema.stockPriceCache.symbol, schema.portfolios.symbol))
      .where(eq(schema.portfolios.gamePlayerId, r.gamePlayerId));
    const markRows = holdings
      .filter((h): h is typeof h & { price: number } => h.price != null)
      .map((h) => ({
        symbol: h.symbol,
        currentPrice: Number(h.price),
        quantity: h.quantity,
        avgCostBasis: Number(h.avgCostBasis),
      }));
    if (markRows.length > 0) {
      await updateMarks(db, r.gamePlayerId, markRows);
    }
  }
```

Imports at the top:

```typescript
import { updateMarks } from './position-high-water.js';
```

(`eq` and `schema` are already imported.)

- [ ] **Step 2: Add a regression test that snapshot updates marks**

Create or extend `packages/server/tests/services/portfolio-snapshot.test.ts`. If a file exists, add a test case; otherwise create one with a minimal scaffold mirroring `position-high-water.test.ts`. The test should:
1. Seed a player, a `portfolios` row, and a `stockPriceCache` row.
2. Call `recordSnapshot(db, gameId)`.
3. Read `positionHighWater` and assert a row was created with the seeded price.

If `portfolio-snapshot.test.ts` doesn't exist and writing one is heavy, skip the test for now — Phase B's achievement tests will exercise the path end-to-end via the harness.

- [ ] **Step 3: Run the full server test suite**

Run: `pnpm --filter server test`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/services/portfolio-snapshot.ts packages/server/tests/services/portfolio-snapshot.test.ts
git commit -m "feat(snapshot): refresh position-high-water marks per tick"
```

(Drop `portfolio-snapshot.test.ts` from the add list if you didn't end up writing one.)

### Task B5: Achievement — Stonks

**Files:**
- Create: `packages/server/src/achievements/definitions/stonks.ts`
- Modify: `packages/server/src/achievements/definitions/index.ts`
- Test: `packages/server/tests/achievements/definitions/stonks.test.ts`

- [ ] **Step 1: Write the definition**

```typescript
import { defineAchievement } from '../define.js';
import { getAllMarks } from '../../services/position-high-water.js';

/**
 * Boolean unlock: any currently open position is up 10% or more relative
 * to its average cost basis. Reads from `position_high_water` rather than
 * recomputing pnl per snapshot.
 */
export default defineAchievement({
  key: 'stonks',
  name: 'Stonks',
  description: 'Hold a position currently up 10% or more.',
  rarity: 'common',
  icon: 'trending-up',
  category: 'behavior',
  target: 1,
  events: ['snapshot.recorded'],
  async onEvent(event, ctx) {
    const marks = await getAllMarks(ctx.db, event.gamePlayerId);
    // peakPnlPct is monotonic over the hold; >= 0.10 means the position
    // has been up 10% at least once.
    if (marks.some((m) => m.peakPnlPct >= 0.1)) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
```

- [ ] **Step 2: Register in index**

Add to `definitions/index.ts`:

```typescript
import stonks from './stonks.js';
```

Place under `// Behavior category`:

```typescript
  stonks,
```

- [ ] **Step 3: Test**

```typescript
import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import { onPositionOpened, updateMarks } from '../../../src/services/position-high-water.js';
import stonks from '../../../src/achievements/definitions/stonks.js';

describe('achievement: stonks', () => {
  it('unlocks when a held position has been up 10% or more', async () => {
    const h = await makeAchievementHarness(stonks);
    await onPositionOpened(h.db, { gamePlayerId: h.gamePlayerId, symbol: 'AAPL', openedAt: '2026-05-27T00:00:00.000Z', currentPrice: 100, quantity: 1, avgCostBasis: 100 });
    await updateMarks(h.db, h.gamePlayerId, [{ symbol: 'AAPL', currentPrice: 112, quantity: 1, avgCostBasis: 100 }]);
    await h.dispatch({
      type: 'snapshot.recorded',
      gameId: h.gameId,
      gamePlayerId: h.gamePlayerId,
      totalValue: 112,
      rank: 1,
      totalPlayers: 1,
      capturedAt: '2026-05-27T00:01:00.000Z',
    });
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock when the position has not risen 10%', async () => {
    const h = await makeAchievementHarness(stonks);
    await onPositionOpened(h.db, { gamePlayerId: h.gamePlayerId, symbol: 'AAPL', openedAt: '2026-05-27T00:00:00.000Z', currentPrice: 100, quantity: 1, avgCostBasis: 100 });
    await updateMarks(h.db, h.gamePlayerId, [{ symbol: 'AAPL', currentPrice: 105, quantity: 1, avgCostBasis: 100 }]);
    await h.dispatch({
      type: 'snapshot.recorded',
      gameId: h.gameId,
      gamePlayerId: h.gamePlayerId,
      totalValue: 105,
      rank: 1,
      totalPlayers: 1,
      capturedAt: '2026-05-27T00:01:00.000Z',
    });
    expect(await h.isUnlocked()).toBe(false);
  });
});
```

- [ ] **Step 4: Run and commit**

```bash
pnpm --filter server test -- --run tests/achievements/definitions/stonks.test.ts
git add packages/server/src/achievements/definitions/stonks.ts packages/server/src/achievements/definitions/index.ts packages/server/tests/achievements/definitions/stonks.test.ts
git commit -m "feat(achievements): add Stonks (position up 10%)"
```

### Task B6: Achievement — This Is Fine

**Files:**
- Create: `packages/server/src/achievements/definitions/this-is-fine.ts`
- Modify: `packages/server/src/achievements/definitions/index.ts`
- Test: `packages/server/tests/achievements/definitions/this-is-fine.test.ts`

- [ ] **Step 1: Definition**

```typescript
import { defineAchievement } from '../define.js';
import { getAllMarks } from '../../services/position-high-water.js';

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Boolean unlock: any currently held position has dropped to -30% or
 * worse AND has been held for at least 3 days since the most recent
 * 0→positive open.
 */
export default defineAchievement({
  key: 'this-is-fine',
  name: 'This Is Fine',
  description: 'Hold a position down 30% or more for 3 days or more.',
  rarity: 'rare',
  icon: 'flame',
  category: 'behavior',
  target: 1,
  events: ['snapshot.recorded'],
  async onEvent(event, ctx) {
    const marks = await getAllMarks(ctx.db, event.gamePlayerId);
    const now = new Date(event.capturedAt).getTime();
    if (
      marks.some(
        (m) =>
          m.troughPnlPct <= -0.3 &&
          now - new Date(m.openedAt).getTime() >= THREE_DAYS_MS,
      )
    ) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
```

- [ ] **Step 2: Register, write test, commit**

Add to index. Test: open a position, drop it to -35%, dispatch a snapshot whose `capturedAt` is 3+ days after `openedAt`, assert unlock. Negative test: same setup but only 1 day later, assert no unlock.

```bash
pnpm --filter server test -- --run tests/achievements/definitions/this-is-fine.test.ts
git add packages/server/src/achievements/definitions/this-is-fine.ts packages/server/src/achievements/definitions/index.ts packages/server/tests/achievements/definitions/this-is-fine.test.ts
git commit -m "feat(achievements): add This Is Fine (held -30% for 3+ days)"
```

### Task B7: Achievement — HODL

**Files:**
- Create: `packages/server/src/achievements/definitions/hodl.ts`
- Modify: `packages/server/src/achievements/definitions/index.ts`
- Test: `packages/server/tests/achievements/definitions/hodl.test.ts`

- [ ] **Step 1: Definition**

```typescript
import { defineAchievement } from '../define.js';
import { getAllMarks } from '../../services/position-high-water.js';

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

/** Boolean unlock: any currently open position has been held for 14+ days. */
export default defineAchievement({
  key: 'hodl',
  name: 'HODL',
  description: 'Hold a single position continuously for 14 days.',
  rarity: 'uncommon',
  icon: 'anchor',
  category: 'behavior',
  target: 1,
  events: ['snapshot.recorded'],
  async onEvent(event, ctx) {
    const marks = await getAllMarks(ctx.db, event.gamePlayerId);
    const now = new Date(event.capturedAt).getTime();
    if (marks.some((m) => now - new Date(m.openedAt).getTime() >= FOURTEEN_DAYS_MS)) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
```

- [ ] **Step 2: Register, test, commit**

Test: open a position with `openedAt: '2026-05-13T...'`, dispatch a snapshot at `'2026-05-27T...'`, assert unlock. Negative: snapshot only 13 days later, assert no unlock.

```bash
git commit -m "feat(achievements): add HODL (14-day continuous hold)"
```

### Task B8: Achievement — Round Tripper

**Files:**
- Create: `packages/server/src/achievements/definitions/round-tripper.ts`
- Modify: `packages/server/src/achievements/definitions/index.ts`
- Test: `packages/server/tests/achievements/definitions/round-tripper.test.ts`

- [ ] **Step 1: Definition**

```typescript
import { defineAchievement } from '../define.js';
import { getAllMarks } from '../../services/position-high-water.js';
import { eq } from 'drizzle-orm';
import { schema } from '../../db/index.js';

/**
 * Boolean unlock: any currently open position reached +50% peak and has
 * since fallen back to -10% or worse, without being sold. Reads peakPnlPct
 * from position_high_water and current pnlPct from the live holding.
 */
export default defineAchievement({
  key: 'round-tripper',
  name: 'Round Tripper',
  description: 'Watch a position rise to +50% then fall back to -10% without selling.',
  rarity: 'rare',
  icon: 'rotate-ccw',
  category: 'pnl',
  target: 1,
  events: ['snapshot.recorded'],
  async onEvent(event, ctx) {
    const marks = await getAllMarks(ctx.db, event.gamePlayerId);
    if (marks.length === 0) return;
    // Need current pnl per holding. Join portfolios with stock_price_cache
    // restricted to this player.
    const holdings = await ctx.db
      .select({
        symbol: schema.portfolios.symbol,
        avgCostBasis: schema.portfolios.avgCostBasis,
        currentPrice: schema.stockPriceCache.price,
      })
      .from(schema.portfolios)
      .leftJoin(schema.stockPriceCache, eq(schema.stockPriceCache.symbol, schema.portfolios.symbol))
      .where(eq(schema.portfolios.gamePlayerId, event.gamePlayerId));

    const pnlBySymbol = new Map<string, number>();
    for (const h of holdings) {
      if (h.currentPrice == null) continue;
      const cost = Number(h.avgCostBasis);
      if (cost <= 0) continue;
      pnlBySymbol.set(h.symbol, Number(h.currentPrice) / cost - 1);
    }

    if (marks.some((m) => m.peakPnlPct >= 0.5 && (pnlBySymbol.get(m.symbol) ?? 0) <= -0.1)) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
```

- [ ] **Step 2: Register, test, commit**

Test: open, push peak to +60%, then drop to -15% (insert a `stockPriceCache` row with the dropped price), dispatch snapshot, assert unlock. Negative: peak only +30%, drop to -15%, assert no unlock.

```bash
git commit -m "feat(achievements): add Round Tripper (+50% peak then -10% drawdown)"
```

### Task B9: Achievement — Diamond-Plated Hands

**Files:**
- Create: `packages/server/src/achievements/definitions/diamond-plated-hands.ts`
- Modify: `packages/server/src/achievements/definitions/index.ts`
- Test: `packages/server/tests/achievements/definitions/diamond-plated-hands.test.ts`

- [ ] **Step 1: Definition**

```typescript
import { defineAchievement } from '../define.js';
import { getMarks } from '../../services/position-high-water.js';

/**
 * Boolean unlock: close a position green (realized pnl ≥ 0) after the
 * position's trough dropped to -20% or worse during the hold. Looks up
 * the marks row BEFORE the trade pipeline's onPositionClosed delete
 * has fired? No — onPositionClosed runs inside the trade transaction
 * and `position.closed` is emitted after commit, so by the time this
 * handler runs the row may already be gone. To guard against that,
 * the trade pipeline keeps the row around until after emit — see
 * Task B3 note. If the row is missing we conservatively skip.
 */
export default defineAchievement({
  key: 'diamond-plated-hands',
  name: 'Diamond-Plated Hands',
  description: 'Close a position green after surviving a 20%+ drawdown while holding it.',
  rarity: 'legendary',
  icon: 'gem',
  category: 'pnl',
  target: 1,
  events: ['position.closed'],
  async onEvent(event, ctx) {
    if (event.realizedPnlPct < 0) return;
    const marks = await getMarks(ctx.db, event.gamePlayerId, event.symbol);
    if (!marks) return;
    if (marks.troughPnlPct <= -0.2) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
```

**Important refinement to Task B3 noted above:** if you discover during testing that the row is gone by the time `position.closed` fires, move the `onPositionClosed` call from inside the trade tx to AFTER the `trade-emit.ts` emit. Likely cleaner placement: inside `emitTradeEvents` in `trade-emit.ts`, in the `if (p.direction === 'sell' && !p.isResting)` branch, AFTER the `bus.emit({ type: 'position.closed', ... })` call. If you make this change, update Task B3 Step 2 accordingly and re-commit B3 with the corrected wiring before continuing.

- [ ] **Step 2: Register, test, commit**

Test path:
1. Seed open position via `onPositionOpened`.
2. `updateMarks` to push trough to -25%.
3. Manually update the `portfolios` row's quantity to 0 (simulating the sell).
4. Dispatch `position.closed` with `realizedPnlPct: 0.1`, `fullyClosed: true`, and a matching symbol.
5. Assert unlock.
   Negative: same but trough only -10%, assert no unlock.

If the row is deleted before the handler runs (verify by inspecting test failures), apply the B3 refinement noted above.

```bash
git commit -m "feat(achievements): add Diamond-Plated Hands (close green after 20%+ drawdown)"
```

---

## Phase C — Cheap achievements

Each of these follows the same shape: definition file, registration in `definitions/index.ts`, test file with 2 cases (unlocks at threshold, doesn't just below), commit.

### Task C1: Buy High, Sell Low

```typescript
// packages/server/src/achievements/definitions/buy-high-sell-low.ts
import { defineAchievement } from '../define.js';

export default defineAchievement({
  key: 'buy-high-sell-low',
  name: 'Buy High, Sell Low',
  description: 'Realize a loss of 25% or more on a single sell.',
  rarity: 'common',
  icon: 'trending-down',
  category: 'pnl',
  target: 1,
  events: ['position.closed'],
  async onEvent(event, ctx) {
    if (event.realizedPnlPct <= -0.25) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
```

Register, test (mirror `bag-holder.test.ts`'s pattern), commit:

```bash
git commit -m "feat(achievements): add Buy High Sell Low (25% loss on a single sell)"
```

### Task C2: Dollar Menu

```typescript
// packages/server/src/achievements/definitions/dollar-menu.ts
import { defineAchievement } from '../define.js';

export default defineAchievement({
  key: 'dollar-menu',
  name: 'Dollar Menu',
  description: 'Execute a trade with total value under $10.',
  rarity: 'common',
  icon: 'utensils',
  category: 'behavior',
  target: 1,
  events: ['trade.executed'],
  async onEvent(event, ctx) {
    if (event.price * event.quantity < 10) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
```

Register, test, commit:

```bash
git commit -m "feat(achievements): add Dollar Menu (trade value under $10)"
```

### Task C3: One Share Wonder

```typescript
// packages/server/src/achievements/definitions/one-share-wonder.ts
import { defineAchievement } from '../define.js';

export default defineAchievement({
  key: 'one-share-wonder',
  name: 'One Share Wonder',
  description: 'Buy exactly 1 share of a stock priced over $500.',
  rarity: 'common',
  icon: 'hash',
  category: 'behavior',
  target: 1,
  events: ['trade.executed'],
  async onEvent(event, ctx) {
    if (event.direction === 'buy' && event.quantity === 1 && event.price > 500) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
```

Register, test, commit:

```bash
git commit -m "feat(achievements): add One Share Wonder (1 share at >$500)"
```

### Task C4: Whale

```typescript
// packages/server/src/achievements/definitions/whale.ts
import { eq } from 'drizzle-orm';
import { defineAchievement } from '../define.js';
import { schema } from '../../db/index.js';

export default defineAchievement({
  key: 'whale',
  name: 'Whale',
  description: 'Execute a single trade worth 25% or more of starting balance.',
  rarity: 'epic',
  icon: 'fish',
  category: 'behavior',
  target: 1,
  events: ['trade.executed'],
  async onEvent(event, ctx) {
    const [game] = await ctx.db
      .select({ startingBalance: schema.games.startingBalance })
      .from(schema.games)
      .where(eq(schema.games.id, ctx.gameId))
      .limit(1);
    if (!game) return;
    if (event.price * event.quantity >= 0.25 * Number(game.startingBalance)) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
```

Register, test (use `makeAchievementHarness({ startingBalance: 10000 })`, fire a `trade.executed` with `price: 100, quantity: 25`), commit:

```bash
git commit -m "feat(achievements): add Whale (single trade >=25% of starting balance)"
```

### Task C5: Penny Stock Enjoyer

```typescript
// packages/server/src/achievements/definitions/penny-stock-enjoyer.ts
import { defineAchievement } from '../define.js';

export default defineAchievement({
  key: 'penny-stock-enjoyer',
  name: 'Penny Stock Enjoyer',
  description: 'Buy a stock priced under $5.',
  rarity: 'uncommon',
  icon: 'coins',
  category: 'behavior',
  target: 1,
  events: ['trade.executed'],
  async onEvent(event, ctx) {
    if (event.direction === 'buy' && event.price < 5) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
```

Register, test, commit:

```bash
git commit -m "feat(achievements): add Penny Stock Enjoyer (buy under $5)"
```

### Task C6: Speedrun Any %

```typescript
// packages/server/src/achievements/definitions/speedrun-any-percent.ts
import { eq } from 'drizzle-orm';
import { defineAchievement } from '../define.js';
import { schema } from '../../db/index.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export default defineAchievement({
  key: 'speedrun-any-percent',
  name: 'Speedrun Any %',
  description: 'Reach 2x starting balance within 7 days of game start.',
  rarity: 'epic',
  icon: 'timer',
  category: 'pnl',
  target: 1,
  events: ['snapshot.recorded'],
  async onEvent(event, ctx) {
    const [game] = await ctx.db
      .select({ startingBalance: schema.games.startingBalance, startDate: schema.games.startDate })
      .from(schema.games)
      .where(eq(schema.games.id, ctx.gameId))
      .limit(1);
    if (!game) return;
    const startingBalance = Number(game.startingBalance);
    if (event.totalValue < 2 * startingBalance) return;
    const elapsed = new Date(event.capturedAt).getTime() - new Date(game.startDate).getTime();
    if (elapsed < SEVEN_DAYS_MS) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
```

Register, test (use a harness with a fixed `startDate` then dispatch a snapshot 6 days later with `totalValue = 20000`), commit:

```bash
git commit -m "feat(achievements): add Speedrun Any % (2x in <7 days)"
```

---

## Phase D — Docs and final verification

### Task D1: Regenerate achievement docs

- [ ] **Step 1: Run the generator**

Run: `pnpm docs:achievements`
Expected: `docs/achievements.md` updated, new PNGs in `docs/achievements/img/` for each of the 13 new keys.

- [ ] **Step 2: Spot-check the markdown**

Confirm each of the 13 new achievements appears in the right category section with correct rarity, icon, target.

- [ ] **Step 3: Commit**

```bash
git add docs/achievements.md docs/achievements/img/
git commit -m "docs(achievements): regenerate reference for new meme achievements"
```

### Task D2: Final verification

- [ ] **Step 1: Typecheck**

Run: `pnpm typecheck`
Expected: clean across all workspaces.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: clean.

- [ ] **Step 3: Full test suite**

Run: `pnpm test`
Expected: all PASS. Expect the count to have grown by ~30 tests (13 achievement tests × 2-3 cases + service tests).

- [ ] **Step 4: Sanity check the branch**

Run: `git log --oneline main..HEAD`
Expected: a clean sequence of commits matching the task names above.

---

## Self-review (run after the plan is written, before execution)

I'm noting potential issues here so the executor can confirm them as they land:

- **Diamond-Plated Hands ordering risk (Task B9):** depends on whether `position_high_water` row exists at the moment `position.closed` fires. The plan flags this and provides a fix path (move `onPositionClosed` from `trade.ts` into `trade-emit.ts` AFTER emit). Verify during B9 testing.
- **Harness compatibility:** `makeAchievementHarness` only registers one definition. The tests above use it directly for single-achievement isolation, which works for all 13 since each is independent. The horse achievement's multi-def test pattern is not needed here.
- **`stocks_price_cache` empty in tests:** the per-holding achievement tests skip the snapshot pipeline (they seed `position_high_water` directly via `onPositionOpened` + `updateMarks`). Round Tripper additionally needs a `stockPriceCache` row because it queries live price — make sure its test seeds one.
- **Migration ordering:** `pnpm --filter server db:generate` in Task A1 and Task B1 will each produce migration files; commit them with the schema change in the same commit so the chain stays linear.
