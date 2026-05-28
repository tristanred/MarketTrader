# Meme Achievements — Design

Date: 2026-05-27
Branch: `feat/achievement-horse`

Ships 13 new achievements in two batches: six that use only existing
event fields, two that need a per-day counter, and five that need a new
per-holding peak/trough tracker. Two pieces of supporting infrastructure
land alongside the achievements.

## Goals

- Expand the achievement catalogue with playful and meme-flavored
  triggers without diluting the existing serious achievements.
- Establish reusable per-day and per-holding tracking primitives so
  future achievements in those categories don't need new plumbing.
- Keep added DB load negligible (see "Performance" below).

## Non-goals

- No frontend changes beyond the auto-regenerated achievement docs.
- No retroactive unlocks for already-running games — new state starts
  populating at migration time.
- No new WebSocket frames or admin endpoints.

## The 13 achievements

### Cheap (existing event fields only)

| Key | Name | Description | Trigger | Rarity | Icon | Category |
|---|---|---|---|---|---|---|
| `buy-high-sell-low` | Buy High, Sell Low | Realize a loss of 25% or more on a single sell. | `position.closed` where `realizedPnlPct <= -0.25` | Common | trending-down | pnl |
| `dollar-menu` | Dollar Menu | Execute a trade with total value under $10. | `trade.executed` where `price * quantity < 10` | Common | utensils | behavior |
| `one-share-wonder` | One Share Wonder | Buy exactly 1 share of a stock priced over $500. | `trade.executed` where `direction === 'buy' && quantity === 1 && price > 500` | Common | hash | behavior |
| `whale` | Whale | Execute a single trade worth 25% or more of starting balance. | `trade.executed` where `price * quantity >= 0.25 * game.startingBalance` | Epic | fish | behavior |
| `penny-stock-enjoyer` | Penny Stock Enjoyer | Buy a stock priced under $5. | `trade.executed` where `direction === 'buy' && price < 5` | Uncommon | coins | behavior |
| `speedrun-any-percent` | Speedrun Any % | Reach 2x starting balance within 7 days of game start. | `snapshot.recorded` where `totalValue >= 2 * startingBalance && (capturedAt - game.startDate) < 7 days` | Epic | timer | pnl |

### Depend on per-day counter infra

| Key | Name | Description | Trigger | Rarity | Icon | Category |
|---|---|---|---|---|---|---|
| `sir-this-is-a-wendys` | Sir, This Is a Wendy's | Execute 20 or more trades in a single UTC day. | `trade.executed`; `setProgress(tradesToday)`, target 20 | Legendary | utensils-crossed | trading |
| `tax-loss-harvester` | Tax Loss Harvester | Close 3 losing positions in a single UTC day. | `position.closed` with `realizedPnl < 0`; `setProgress(losingSellsToday)`, target 3 | Uncommon | receipt | trading |

### Depend on per-holding peak/trough infra

| Key | Name | Description | Trigger | Rarity | Icon | Category |
|---|---|---|---|---|---|---|
| `stonks` | Stonks | Hold an open position currently up 10% or more. | `snapshot.recorded`; any open holding with `currentPnlPct >= 0.10` | Common | trending-up | behavior |
| `this-is-fine` | This Is Fine | Hold a position down 30% or more for 3 days or more without selling. | `snapshot.recorded`; row exists where `troughPnlPct <= -0.30 && (now - openedAt) >= 3 days` AND position still held | Rare | flame | behavior |
| `hodl` | HODL | Hold a single position continuously for 14 days. | `snapshot.recorded`; any open holding with `(now - openedAt) >= 14 days` | Uncommon | anchor | behavior |
| `round-tripper` | Round Tripper | Watch a single position rise to +50% then fall back to -10% without selling. | `snapshot.recorded`; row where `peakPnlPct >= 0.50 && currentPnlPct <= -0.10` AND position still held | Rare | rotate-ccw | pnl |
| `diamond-plated-hands` | Diamond-Plated Hands | Close a position green after surviving a 20%+ drawdown while holding it. | `position.closed`; row's `troughPnlPct <= -0.20 && event.realizedPnlPct >= 0` | Legendary | gem | pnl |

## Infrastructure

### A. Per-day trade counters

**Schema change.** Three new columns on `game_player_stats`:

- `tradesUtcDate text` — UTC day (`YYYY-MM-DD`) the counters apply to.
  Null until the first trade.
- `tradesToday integer not null default 0`
- `losingSellsToday integer not null default 0`

**Update path.** Extend the existing rollup in
`packages/server/src/services/game-player-stats.ts`:

1. On every `trade.executed`, compute the trade's UTC date. If it
   differs from `tradesUtcDate`, reset both counters to 0 and overwrite
   `tradesUtcDate`. Then `tradesToday += 1`.
2. On every `position.closed` with `realizedPnl < 0`, perform the same
   day-rollover check, then `losingSellsToday += 1`.

The two consuming achievements simply read the relevant counter via
`ctx.db` and call `setProgress(value)`. Day rollovers don't lower the
displayed progress because the achievement is one-day-scoped: once a
new day starts, the target was either met (already unlocked) or
abandoned (acceptable — the achievement is meant to capture a single
chaotic day).

### B. Per-holding peak/trough tracker

**Schema change.** New table `position_high_water`:

```
gamePlayerId  text  PK (composite)
symbol        text  PK (composite)
openedAt      text  ISO 8601 — when the most recent 0→positive open occurred
peakValue     real  highest (price * qty) observed since openedAt
peakPnlPct    real  highest (price / avgCostBasis - 1) observed since openedAt
troughPnlPct  real  lowest (price / avgCostBasis - 1) observed since openedAt
updatedAt     text  ISO 8601
```

**New service.** `packages/server/src/services/position-high-water.ts`:

- `onPositionOpened(gamePlayerId, symbol, openedAt, currentPrice, qty, avgCostBasis)`
  — INSERT (or REPLACE) a row with peak/trough seeded at the current
  values. Called when a buy takes the holding qty from 0 to positive.
- `onPositionClosed(gamePlayerId, symbol)` — DELETE the row. Called
  when `fullyClosed === true` in the trade pipeline.
- `updateMarks(gamePlayerId, holdings, prices)` — called per player
  per snapshot. For each open holding, compute `currentPnlPct` and
  `currentValue`. **Skip-when-unchanged**: if `trough <= currentPnlPct
  <= peak` and `currentValue <= peakValue`, do nothing. Otherwise
  UPSERT with the new bounds.
- `getMarks(gamePlayerId, symbol)` and `getAllMarks(gamePlayerId)` —
  read helpers used by achievement handlers.

**Pipeline wiring.**

- Trade pipeline (`packages/server/src/services/trade-execution.ts` or
  wherever the buy/sell handlers live; verify during implementation):
  - On buy that increments qty from 0 to positive → call
    `onPositionOpened`.
  - On sell that emits `position.closed` with `fullyClosed === true`
    → call `onPositionClosed`.
- Snapshot pipeline (`packages/server/src/services/leaderboard.ts` or
  the snapshot-recorder; verify during implementation): right before
  emitting `snapshot.recorded`, call `updateMarks(gamePlayerId,
  holdings, prices)` with the data already in scope for the snapshot.

No new domain event is needed. Consuming achievements listen on
`snapshot.recorded` (already fires per player per minute) and
`position.closed`, reading from `position_high_water` directly via
`ctx.db`.

## Performance

Per snapshot tick (one minute), with N players holding K symbols each:

- Baseline today: N reads + N snapshot writes per game.
- Added cost (naive): N * K upserts.
- Added cost (with skip-when-unchanged): typically 5-10% of N * K, i.e.
  rows only get written when the high or low actually moves.

Realistic ceiling (20 players holding 20 symbols each = `index-fund`
cap): under 40 writes per tick after the skip optimization. Negligible
on both SQLite (dev/test) and Postgres (prod).

Read side: per-holding achievements either look up a single
`(gamePlayerId, symbol)` PK or scan all rows for one `gamePlayerId`
(at most K, bounded by `index-fund`'s cap of 20). Microsecond-level
in both cases.

If contention ever materializes, the spec explicitly leaves these
options on the table without implementing them now:
- In-process write-back cache flushed every N ticks.
- Single multi-row upsert per player per tick.

## File layout

```
packages/server/src/
  achievements/definitions/
    buy-high-sell-low.ts          (new)
    dollar-menu.ts                (new)
    one-share-wonder.ts           (new)
    whale.ts                      (new)
    penny-stock-enjoyer.ts        (new)
    speedrun-any-percent.ts       (new)
    sir-this-is-a-wendys.ts       (new)
    tax-loss-harvester.ts         (new)
    stonks.ts                     (new)
    this-is-fine.ts               (new)
    hodl.ts                       (new)
    round-tripper.ts              (new)
    diamond-plated-hands.ts       (new)
    index.ts                      (modified — register all 13)
  db/
    schema.sqlite.ts              (modified — add columns, add table)
    schema.pg.ts                  (modified — add columns, add table)
    migrations/                   (new files generated)
  services/
    game-player-stats.ts          (modified — daily counters)
    position-high-water.ts        (new service)
    trade-execution.ts            (modified — call open/close hooks; verify path)
    leaderboard.ts                (modified — call updateMarks; verify path)

packages/server/tests/
  achievements/definitions/
    <one .test.ts per achievement>  (13 new files)
  services/
    position-high-water.test.ts   (new)
    game-player-stats.test.ts     (modified — add daily counter cases)
  helpers/
    position-high-water-harness.ts  (new — seeds rows directly for tests)

docs/
  achievements.md                 (regenerated)
  achievements/img/*.png          (regenerated)
```

The exact filenames of the trade-execution and snapshot-pipeline
modules need to be verified during implementation — the names above
are the obvious candidates. The wiring is unambiguous either way.

## Build order

1. Per-day counter infra: schema columns, migration, extend
   `game-player-stats.ts`, add unit tests for day rollover.
2. Achievements that depend on it: `sir-this-is-a-wendys`,
   `tax-loss-harvester`. Verify end-to-end with the harness.
3. Per-holding peak/trough infra: schema table, migration,
   `position-high-water.ts` service, wire into trade + snapshot
   pipelines, unit tests for the service.
4. Achievements that depend on it: `stonks`, `this-is-fine`, `hodl`,
   `round-tripper`, `diamond-plated-hands`.
5. Six cheap achievements: `buy-high-sell-low`, `dollar-menu`,
   `one-share-wonder`, `whale`, `penny-stock-enjoyer`,
   `speedrun-any-percent`. Any order, parallelizable.
6. `pnpm docs:achievements` regeneration.
7. Final `pnpm typecheck && pnpm lint && pnpm test`.

Build infrastructure before its consumers so each achievement gets
verified against real state as it lands.

## Test strategy

Each achievement: minimum two tests (unlocks at threshold, does not
unlock just below). Mirrors `market-maker.test.ts` and the existing
harness pattern in `tests/helpers/achievement-harness.ts`.

`position-high-water` service tests:

- Opening a position seeds peak/trough at current values.
- `updateMarks` skips writes when current pnlPct stays inside the
  existing band and value stays under peakValue (asserted by mocking
  the underlying db.update spy).
- `updateMarks` writes when pnlPct breaks the band on either side.
- Closing a position deletes the row.
- Re-opening (qty 0 → positive after a prior full close) creates a
  fresh row with `openedAt` overwritten and peak/trough re-seeded.

`game-player-stats` extension tests:

- Trades on the same UTC day increment `tradesToday` cumulatively.
- A trade on a new UTC day resets `tradesToday` to 1 and
  overwrites `tradesUtcDate`.
- `losingSellsToday` behaves the same way; profitable closes do
  not increment it.

For the five per-holding achievements, the new
`position-high-water-harness.ts` helper seeds rows directly so tests
can drive the achievement without running the full snapshot pipeline.

## Migration and rollout

- Two generated migrations: one for SQLite, one for Postgres. Both
  shipped in this PR via `pnpm --filter server db:generate`.
- New columns default to `NULL` / `0`. New table starts empty.
- No backfill. Already-running games will start tracking from the
  next snapshot tick after migration. The five per-holding
  achievements simply won't fire on already-held positions until the
  next tick refreshes their marks — acceptable because these
  achievements are net-new and have no retroactive expectation.
- The two per-day achievements will fire on the first trade after
  migration, since `tradesUtcDate` is null and triggers the rollover
  branch which sets `tradesToday = 1`.

## Dropped candidates

For the record, two candidates were proposed and dropped during
brainstorming:

- **Paper Hands Speedrun** (buy + sell within 60s) — duplicated the
  existing `paper-hands` achievement at a tighter threshold without
  meaningful distinction.
- **Comeback Story** (recover from -30% to starting balance) —
  duplicated the existing `phoenix` achievement (-25% trough →
  recover to starting) at a marginally different threshold.

Both could be revisited later if a fundamentally different mechanic
is found.
