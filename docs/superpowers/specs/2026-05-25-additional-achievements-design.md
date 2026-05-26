# Additional Achievements — Design

**Date:** 2026-05-25
**Status:** Approved, pending implementation plan
**Related:** [`docs/superpowers/specs/2026-05-23-achievements-system-design.md`](2026-05-23-achievements-system-design.md) (base system)

---

## 1. Goal

Expand the achievement catalog from 3 to 43 (40 new + 3 existing, one updated) to make the game more engaging across multiple play styles: trade volume, P&L outcomes, ranking dynamics, portfolio shape, behavioral signatures, and game-end finales.

Numeric thresholds are expressed as percentages, ratios, or day counts so they scale with any game configuration (starting balance, duration, player count).

---

## 2. Architecture Changes

### 2.1 New domain events

Both events are emitted server-internal only (consistent with existing events; never broadcast to clients directly). Both are emitted after the same DB commit that owns the underlying state change, mirroring the existing `trade.executed` pattern.

#### `position.closed`

Fires every time a sell trade executes. Carries the realized P&L of the closed slice so achievement handlers don't need to look up cost basis themselves.

```ts
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
  /** Milliseconds between the most recent open of this position (qty 0 → positive) and this sell. */
  holdDurationMs: number;
  /** Whether this sell brought quantity to 0 (a full close). */
  fullyClosed: boolean;
  closedAt: string;
}
```

**Hold-duration source:** the trade executor reads the first buy that brought the position from 0 → positive (the `openedAt`). Since the `portfolios` row is deleted when quantity hits 0 and recreated on the next buy, the "open" of the current position is the most recent buy after a deletion. We store an `openedAt: string` column on `portfolios` set on the first buy and unchanged through subsequent buys until the position is fully closed.

#### `holdings.changed`

Fires alongside `trade.executed`, after the portfolio row is updated. Carries derived metrics so portfolio-shape achievements never need ad-hoc queries.

```ts
export interface HoldingsChangedEvent {
  type: 'holdings.changed';
  gameId: string;
  gamePlayerId: string;
  /** Count of portfolio rows with quantity > 0 after the trade. */
  distinctSymbols: number;
  /** Largest single-symbol value ÷ total portfolio value (0 if 0 holdings). */
  topConcentrationRatio: number;
  /** Cash ÷ total portfolio value. */
  cashRatio: number;
  changedAt: string;
}
```

### 2.2 New schema: `game_player_stats`

A 1:1 sidecar table to `gamePlayers`. Holds per-player rollups that are expensive to recompute or that achievement handlers need cheap access to. Future achievements can add columns here without bloating the hot `gamePlayers` row (which is touched on every trade for cash balance).

```ts
export const gamePlayerStats = sqliteTable('game_player_stats', {
  gamePlayerId: text('game_player_id')
    .primaryKey()
    .references(() => gamePlayers.id, { onDelete: 'cascade' }),

  // Portfolio value extremes (snapshot-driven)
  peakPortfolioValue: real('peak_portfolio_value'),
  peakPortfolioAt: text('peak_portfolio_at'),
  troughPortfolioValue: real('trough_portfolio_value'),
  troughPortfolioAt: text('trough_portfolio_at'),

  // Ranking — snapshot-level
  bestRank: integer('best_rank'),
  worstRank: integer('worst_rank'),
  lastRank: integer('last_rank'),

  // Ranking — day-level (UTC days)
  daysAtRankOne: integer('days_at_rank_one').notNull().default(0),
  consecutiveDaysAtRankOne: integer('consecutive_days_at_rank_one').notNull().default(0),
  daysInTopThree: integer('days_in_top_three').notNull().default(0),
  consecutiveDaysAtOrAboveMedian: integer('consecutive_days_at_or_above_median').notNull().default(0),
  consecutiveDaysInLastPlace: integer('consecutive_days_in_last_place').notNull().default(0),
  /** Last UTC day (YYYY-MM-DD) for which day-level counters were advanced. */
  lastDayCounted: text('last_day_counted'),
  /** Rank as of the last UTC day (used for Comeback Kid / Free Fall day-over-day deltas). */
  lastDayRank: integer('last_day_rank'),

  // Trade volume (trade-driven)
  totalTrades: integer('total_trades').notNull().default(0),
  buyTrades: integer('buy_trades').notNull().default(0),
  sellTrades: integer('sell_trades').notNull().default(0),
  distinctSymbolsTradedEver: integer('distinct_symbols_traded_ever').notNull().default(0),
  totalVolumeTraded: real('total_volume_traded').notNull().default(0),

  // P&L (position.closed-driven)
  realizedPnl: real('realized_pnl').notNull().default(0),
  winningClosedPositions: integer('winning_closed_positions').notNull().default(0),
  losingClosedPositions: integer('losing_closed_positions').notNull().default(0),
  consecutiveWins: integer('consecutive_wins').notNull().default(0),
  bestSinglePnl: real('best_single_pnl'),
  worstSinglePnl: real('worst_single_pnl'),
  bestSinglePnlPct: real('best_single_pnl_pct'),
  worstSinglePnlPct: real('worst_single_pnl_pct'),

  // Behavioral
  shortestHoldMs: integer('shortest_hold_ms'),
  longestHoldMs: integer('longest_hold_ms'),

  updatedAt: text('updated_at').default(sql`(datetime('now'))`).notNull(),
});
```

**Both schemas (`schema.sqlite.ts` and `schema.pg.ts`) must be kept in sync by hand**, per project convention.

### 2.3 Write path

- **Trade executor** (`packages/server/src/services/trade.ts` or equivalent): inside the existing trade transaction, after updating `portfolios` and `gamePlayers.cashBalance`:
  1. Update trade-driven `game_player_stats` columns (`totalTrades`, `buyTrades`/`sellTrades`, `totalVolumeTraded`, `distinctSymbolsTradedEver`).
  2. On sells: compute realized P&L, hold duration, update P&L columns (`realizedPnl`, `winningClosedPositions`/`losingClosedPositions`, `consecutiveWins`, best/worst single, `shortestHoldMs`/`longestHoldMs`).
  3. Compute and emit `position.closed` (sells only) and `holdings.changed` (all trades).
- **Snapshot recorder** (`packages/server/src/services/portfolio-snapshot.ts`): inside the existing snapshot transaction:
  1. Update snapshot-driven columns: `peakPortfolioValue`/`peakPortfolioAt`, `troughPortfolioValue`/`troughPortfolioAt`, `bestRank`, `worstRank`, `lastRank`.
  2. If the snapshot's UTC day differs from `lastDayCounted`, advance day-level counters using the player's *latest snapshot of the previous day* (cached as `lastDayRank`), then set `lastDayCounted` and `lastDayRank`.
- **Position open tracking:** `portfolios.openedAt` is set on the buy that brings quantity from 0 → positive and remains unchanged through subsequent buys until the row is deleted (full close).

### 2.4 Categories

Six total: `trading`, `pnl`, `portfolio`, `standing`, `behavior`, `finale`. The first two are extensions of the existing `trading` and `standing` categories; the rest are new.

### 2.5 Migration of `rock-bottom`

Existing definition is "last place for 5 consecutive snapshots." Updated to "last place for 3 consecutive days." This requires:
- Updating the definition's `description` and `target`.
- Switching its handler to read `consecutiveDaysInLastPlace` from `game_player_stats` (instead of the engine's progress counter).
- Resetting existing in-progress rows (set `progress = 0` for any non-unlocked row). Unlocked rows are not affected.

---

## 3. Achievement Catalog

Rarity distribution target (pyramid): ~14 common, ~12 uncommon, ~8 rare, ~4 epic, ~2 legendary.

All trade-volume thresholds count *executed* trades (any direction unless noted). All ranking thresholds count UTC days. All P&L percentages are relative to the position's `avgCostBasis` at sell time. All portfolio-value thresholds are relative to `games.startingBalance`.

### 3.1 Category: `trading` (6)

| # | Key | Name | Description | Rarity | Event |
|---|---|---|---|---|---|
| 1 | `apprentice` | Apprentice | Execute 12 trades. | common | `trade.executed` |
| 2 | `day-trader` | Day Trader | Execute 25 trades. | uncommon | `trade.executed` |
| 3 | `market-maker` | Market Maker | Execute 50 trades. | rare | `trade.executed` |
| 4 | `first-sale` | First Sale | Execute your first sell. | common | `trade.executed` |
| 5 | `sampler` | Sampler | Trade 5 distinct symbols. | common | `trade.executed` (reads `stats.distinctSymbolsTradedEver`) |
| 6 | `globe-trotter` | Globe Trotter | Trade 15 distinct symbols. | uncommon | `trade.executed` |

### 3.2 Category: `pnl` (12)

| # | Key | Name | Description | Rarity | Event |
|---|---|---|---|---|---|
| 7 | `first-blood` | First Blood | Close your first profitable position. | common | `position.closed` |
| 8 | `green-streak` | Green Streak | Close 5 winning positions in a row. | uncommon | `position.closed` (reads `stats.consecutiveWins`) |
| 9 | `moonshot` | Moonshot | Close a single position with ≥50% gain. | rare | `position.closed` |
| 10 | `ten-bagger` | Ten-Bagger | Close a single position with ≥10× return (+900% gain, `realizedPnlPct >= 9.0`). | legendary | `position.closed` |
| 11 | `bag-holder` | Bag Holder | Close a single position with ≥50% loss. | uncommon | `position.closed` |
| 12 | `catastrophe` | Catastrophe | Close a single position with ≥90% loss. | rare | `position.closed` |
| 13 | `double-up` | Double Up | Portfolio reaches 2× starting balance. | epic | `snapshot.recorded` |
| 14 | `triple-threat` | Triple Threat | Portfolio reaches 3× starting balance. | legendary | `snapshot.recorded` |
| 15 | `underwater` | Underwater | Portfolio drops to ≤50% of starting balance. | uncommon | `snapshot.recorded` |
| 16 | `phoenix` | Phoenix | After dropping to ≤75% of starting balance, return to ≥starting balance. | rare | `snapshot.recorded` (reads `stats.troughPortfolioValue`) |
| 17 | `locked-in` | Locked In | Cumulative realized P&L ≥ 25% of `game.startingBalance`. | uncommon | `position.closed` (reads `stats.realizedPnl`) |
| 18 | `wolf-of-markettrader` | Wolf of MarketTrader | Cumulative realized P&L ≥ 100% of `game.startingBalance`. | epic | `position.closed` (reads `stats.realizedPnl`) |

### 3.3 Category: `portfolio` (6)

| # | Key | Name | Description | Rarity | Event |
|---|---|---|---|---|---|
| 19 | `diversified` | Diversified | Hold ≥10 distinct symbols simultaneously. | uncommon | `holdings.changed` |
| 20 | `index-fund` | Index Fund | Hold ≥20 distinct symbols simultaneously. | rare | `holdings.changed` |
| 21 | `all-in` | All In | Hold a single position worth ≥90% of portfolio value. | uncommon | `holdings.changed` |
| 22 | `cash-is-king` | Cash Is King | Go to 100% cash (zero holdings) after having held ≥5 distinct symbols this game. | uncommon | `holdings.changed` |
| 23 | `fully-invested` | Fully Invested | Drive cash to ≤1% of portfolio value. | common | `holdings.changed` |
| 24 | `concentrated-bet` | Concentrated Bet | Open a single new position worth ≥50% of cash at order entry. | uncommon | `trade.executed` (computed pre-trade: `qty × price ≥ 0.5 × cashBeforeTrade`) |

### 3.4 Category: `standing` (8 — includes migrated `rock-bottom`)

| # | Key | Name | Description | Rarity | Event |
|---|---|---|---|---|---|
| 25 | `top-of-the-class` | Top of the Class | Be rank 1 at any point. | common | `snapshot.recorded` |
| 26 | `reigning-champ` | Reigning Champ | Be rank 1 on 3 consecutive days. | rare | `snapshot.recorded` (reads `stats.consecutiveDaysAtRankOne`) |
| 27 | `untouchable` | Untouchable | Be rank 1 on 7 cumulative days. | epic | `snapshot.recorded` (reads `stats.daysAtRankOne`) |
| 28 | `podium-days` | Podium | Be in top 3 on 5 cumulative days. | uncommon | `snapshot.recorded` (reads `stats.daysInTopThree`) |
| 29 | `above-average` | Above Average | Be at or above median rank on 7 consecutive days. | uncommon | `snapshot.recorded` (reads `stats.consecutiveDaysAtOrAboveMedian`) |
| 30 | `comeback-kid` | Comeback Kid | Climb ≥3 ranks day-over-day. | rare | `snapshot.recorded` (compares current rank to `stats.lastDayRank`) |
| 31 | `free-fall` | Free Fall | Drop ≥3 ranks day-over-day. | uncommon | `snapshot.recorded` (compares current rank to `stats.lastDayRank`) |
| — | `rock-bottom` | Rock Bottom | Last place for 3 consecutive days. *(migrated from 5 consecutive snapshots)* | epic | `snapshot.recorded` (reads `stats.consecutiveDaysInLastPlace`) |

### 3.5 Category: `behavior` (4)

| # | Key | Name | Description | Rarity | Event |
|---|---|---|---|---|---|
| 32 | `paper-hands` | Paper Hands | Close a position less than 5 minutes after opening it. | common | `position.closed` |
| 33 | `diamond-hands` | Diamond Hands | Close a position after holding ≥7 days. | rare | `position.closed` |
| 34 | `revenge-trade` | Revenge Trade | Re-buy a symbol within 1 hour of selling it. | uncommon | `trade.executed` (queries recent executed sell on the same symbol via `ctx.db`; v1 omits the "at a loss" filter — reliably attributing realized P&L to a specific prior sell requires schema we don't have yet) |
| 35 | `fomo` | FOMO | Buy a symbol within 5 minutes of it first appearing on another player's portfolio in this game. | rare | `trade.executed` (queries `portfolios` rows in this game with this symbol, ordered by `openedAt`; flagged as the costliest handler) |

### 3.6 Category: `finale` (5)

All fire on `game.ended` using the `finalRanking` payload (no extra queries except #40).

| # | Key | Name | Description | Rarity |
|---|---|---|---|---|
| 36 | `champion` | Champion | Finish rank 1. | epic |
| 37 | `podium-finish` | Podium Finish | Finish in top 3. | rare |
| 38 | `honourable-mention` | Honourable Mention | Finish in top half (games with ≥4 players). | common |
| 39 | `wooden-spoon` | Wooden Spoon | Finish last (games with ≥3 players). | uncommon |
| 40 | `wire-to-wire` | Wire to Wire | Be rank 1 in the first recorded snapshot AND finish rank 1. | legendary |

### 3.7 Final rarity tally

Counting both new achievements and the 3 existing ones (`first-trade`, `ten-buys`, migrated `rock-bottom`):

- Common: 9 (1 existing + 8 new)
- Uncommon: 16 (1 existing + 15 new)
- Rare: 10
- Epic: 5 (1 migrated + 4 new)
- Legendary: 3
- **Total: 43**

This skews uncommon-heavy compared to the strict pyramid (14/12/8/4/2) discussed during brainstorming. The two main causes are:

1. Behavioral/portfolio achievements naturally cluster in the uncommon tier — they're notable but achievable in a single game with intent.
2. Several rare-tier achievements (Market Maker, Index Fund, Diamond Hands) were intentionally pushed up because they require sustained behavior, not a one-time threshold.

If a stricter pyramid is desired during implementation, the easiest rebalances are: demote 4–5 uncommons that are easy to hit by accident (e.g. `free-fall`, `cash-is-king`, `underwater`, `bag-holder`) to common, and demote 2 rares (`comeback-kid`, `podium-finish`) to uncommon. This is an implementation-time call, not a design-time blocker.

---

## 4. Implementation Notes

### 4.1 Per-achievement cost flags

- **Most achievements:** O(1) — read 1–2 columns from `game_player_stats` and call `ctx.unlock` / `ctx.increment` / `ctx.setProgress`.
- **#34 Revenge Trade:** one indexed query against recent `position.closed` events for the symbol. Need either a new `closed_positions` table (append-only log of closed positions) or scan `trades` filtered to `direction=sell` for the symbol in the last hour. Recommend the trades scan to avoid new tables.
- **#35 FOMO:** one query against `portfolios` rows for the symbol across all players in the game, ordered by `openedAt`. Bounded by the number of players. Acceptable.
- **#40 Wire to Wire:** read the earliest `portfolio_snapshots` row for the player at `game.ended` time and check `rank = 1`. One indexed lookup.

### 4.2 Day-level counter semantics

A "day" is a UTC calendar day (`YYYY-MM-DD` derived from the snapshot's `capturedAt`). On each snapshot:
- If the snapshot's day equals `stats.lastDayCounted`, no day-level counters change.
- If it differs, the day-level counters are advanced *based on the player's standing on the most recent snapshot of the prior day*, then `lastDayCounted` and `lastDayRank` are updated.

This makes the counters insensitive to snapshot cadence and keeps logic in one place.

### 4.3 Testing

- Unit tests per definition under `packages/server/tests/achievements/definitions/<key>.test.ts`, using the existing test harness (in-memory SQLite, fake event bus).
- Stats-update tests under `packages/server/tests/services/game-player-stats.test.ts`.
- A handful of integration tests under `packages/server/tests/achievements/` that drive trades/snapshots through the real trade executor and assert unlock broadcasts.

### 4.4 Frontend

No frontend code changes required beyond what the existing achievement-display system already supports (icons, rarity colors, category grouping). The frontend reads definitions from the API, so adding 40 entries on the server is enough. New category labels (`pnl`, `portfolio`, `behavior`, `finale`) need to be rendered in the UI; verify the category-grouping component handles unknown categories gracefully or add the new ones to its display config.

### 4.5 Icons

Each new achievement needs a Lucide icon name (kebab-case). To be assigned during implementation; the design does not pin them. Suggested mapping examples: `moonshot` → `rocket`, `ten-bagger` → `gem`, `bag-holder` → `package`, `diamond-hands` → `diamond`, `paper-hands` → `feather`, `wooden-spoon` → `utensils`, `champion` → `trophy`, `wire-to-wire` → `flag`. Final assignment up to implementer.

---

## 5. Out of Scope

- Achievement notifications outside of the in-game toast (no email/push).
- Cross-game achievements (e.g. "win 3 games"). Stats are game-scoped.
- Player profiles / lifetime achievement aggregation.
- Achievement-driven rewards or unlocks beyond display.
