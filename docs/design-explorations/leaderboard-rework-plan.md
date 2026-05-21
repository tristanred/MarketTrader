# Leaderboard rework — implementation plan

**Branch:** `feat/leaderboard-rework`
**Design reference:** [`leaderboard-graph.html`](./leaderboard-graph.html)
**Status:** plan; not started

---

## What's shipping

1. **Centre-column LeaderboardPanel** with per-row sparklines, top-10 collapse, pinned "you" row.
2. **New dedicated page** `/games/:gameId/leaderboard` — race chart with crowd-handling, podium, full standings, movers, tournament stats.
3. **Backend snapshot infrastructure** powering both: a 5-minute portfolio-value snapshot table + `GET /games/:id/leaderboard/history`.
4. **WebSocket extension**: stream the latest snapshot point so sparklines stay live without re-polling.

Layout side-effect: Leaderboard leaves the 280px left rail. Watchlist + Activity migrate left to fill the space. Right rail gains a "Today's Movers" panel.

---

## Sequencing (5 phases, each independently shippable)

```
Phase 1  ─►  Snapshot model + worker            (server only)
Phase 2  ─►  History endpoint + types           (server + shared)
Phase 3  ─►  New LeaderboardPanel + sparklines  (frontend)
Phase 4  ─►  Arena re-layout                    (frontend)
Phase 5  ─►  /games/:id/leaderboard page        (frontend)
```

Phase 1 unblocks everything else. Phases 3/4/5 can be split across PRs but should land in order on the same branch since Phase 4 deletes the old left-rail panel.

---

## Phase 1 — snapshot model + worker

**Goal:** every 5 minutes (and once on each leaderboard recompute), persist `(gameId, gamePlayerId, t, totalValue, rank)` per active game.

### Files to add

- `packages/server/src/db/schema.sqlite.ts` — append `portfolioSnapshots` table
- `packages/server/src/db/schema.pg.ts` — same, postgres dialect
- `packages/server/src/services/portfolio-snapshot.ts` — `recordSnapshot(db, gameId)` and `recordSnapshotsForActiveGames(db)`
- `packages/server/src/workers/portfolio-snapshot.ts` — `startPortfolioSnapshotWorker({ db, intervalMs, logger })`
- `packages/server/src/app.ts` — register the new worker alongside `startPendingOrdersWorker`
- `packages/server/src/env.ts` — `PORTFOLIO_SNAPSHOT_INTERVAL_MS` (default 5 \* 60 \* 1000)

### Schema

```ts
// portfolio_snapshots
{
  id:            text pk uuid,
  gameId:        text fk → games.id, cascade delete,
  gamePlayerId:  text fk → game_players.id, cascade delete,
  capturedAt:    text ISO-8601 (default now()),
  totalValue:    real,
  rank:          integer,           // rank at capture time
}
// index (gameId, capturedAt) for range queries
// index (gamePlayerId, capturedAt) for per-player sparkline lookups
```

`rank` is denormalised — recomputing the whole leaderboard for every snapshot row is too expensive at read time. Capture it once at write time and trust it; the history endpoint never recomputes rank from value.

Also add one nullable column to the existing `games` table:

```ts
// games (existing)
+ snapshotsCompactedAt: text  // ISO; null until the post-end compaction has run
```

Used by Phase 1's compaction sweep so we don't re-scan already-compacted ended games every 5 minutes.

### Worker behaviour

- Tick interval: 5 minutes.
- Re-entrancy guarded (`running` flag, mirror of pending-orders worker).
- On each tick: list all `active` games (recompute status first via `recomputeMany`), then per game:
  - Run `computeLeaderboard(db, gameId)` to get current per-player `totalValue` + `rank`.
  - Bulk-insert one row per player into `portfolio_snapshots`.
- Skip games with no players.
- **Do not** snapshot `pending` (not started) or `ended` games — the latter's history is already complete.
- Also expose a one-shot `recordSnapshot(db, gameId)` and call it from the pending-orders worker's "leaderboard refresh" path so a trade execution immediately produces a fresh point (avoids "trades happen, sparkline doesn't update for 5 minutes").

### Retention — compact ended games to daily granularity

The snapshot worker also runs a compaction sweep once per tick. For every game whose `status` transitioned to `ended` since the previous tick (or any `ended` game with more than one snapshot row per player per day, to cover games that ended outside a tick window):

1. Find all snapshot rows for that game.
2. Bucket by `(gamePlayerId, date(capturedAt))`.
3. Within each bucket keep only the **last** row of the day (closest to market close), delete the rest.

Active games keep full 5-minute resolution. Ended games shrink from ~8,600 rows/player to ~30 rows/player (one per game day). The compaction is idempotent — re-running it on an already-compacted game is a no-op.

Implementation lives next to the snapshot worker as `compactEndedGames(db)`. Add a `compactedAt` column on `games` (nullable text ISO) so we don't re-scan already-compacted ended games every tick — set it once the bucket reduction is done.

### Tests

- `services/portfolio-snapshot.test.ts` — given a game with 3 players holding mixed positions, asserts the snapshot rows are written with correct rank ordering.
- `services/portfolio-snapshot.compaction.test.ts` — ended game with 5-minute rows over 3 days compacts to 3 rows per player (last-of-day); idempotent on re-run; `snapshotsCompactedAt` set after; active games untouched.
- `workers/portfolio-snapshot.test.ts` — fake timers, verify re-entrancy guard and that only `active` games are snapshotted; compaction runs once per ended game.

---

## Phase 2 — history endpoint + shared types

**Goal:** one endpoint feeds sparklines, the in-panel chart (none for now), and the dedicated page.

### Files

- `packages/shared/src/types/leaderboard-history.ts` (new)
- `packages/shared/src/index.ts` — export it
- `packages/server/src/routes/games.ts` — add the `GET /games/:id/leaderboard/history` handler
- `packages/server/src/services/leaderboard-history.ts` (new) — query + range filtering + downsampling

### Endpoint shape

```
GET /games/:id/leaderboard/history?range=1d|5d|10d|all&maxPoints=240
```

Auth: same membership check as `GET /games/:id` (must be a player in the game).

Response (shared type `LeaderboardHistoryResponse`):

```ts
{
  range: '1d' | '5d' | '10d' | 'all',
  startedAt: string,       // ISO of game.startDate or now-rangeMs, whichever is later
  endedAt:   string,       // ISO of now (or game.endDate if ended)
  series: Array<{
    playerId: string,
    username: string,
    points: Array<{ t: string; v: number; r: number }>,
  }>,
}
```

- `range='all'` clamps to game start.
- `maxPoints` (default 240) triggers LTTB (Largest-Triangle-Three-Buckets) downsampling on the server so the wire payload stays bounded even for long games. Sparkline calls will request `maxPoints=60`; the dedicated page chart will request 240.

### Why include `rank` per point

The dedicated page's "Rank" view mode plots y = rank, not value. Recomputing rank on the client from per-point values requires every player's value at every timestamp — possible but expensive on a 31-player game. Denormalising in Phase 1 makes this free.

### Caching

In-memory LRU keyed by `(gameId, range)`, 30-second TTL. Invalidate the entry whenever Phase 1's `recordSnapshot` runs for that game. Reuse the pattern from `providers/cached-provider.ts`.

### Tests

- `routes/games.history.test.ts` — auth (403 for non-member), range filtering, downsampling cap, ordered points per series.
- `services/leaderboard-history.test.ts` — LTTB preserves endpoints + peaks; rank values come from the snapshot row, not recomputed.

---

## Phase 3 — frontend: new LeaderboardPanel + Sparkline

**Goal:** the centre-column panel from the mockup. Standalone, can be tested before the arena re-layout lands.

### Files

- `packages/frontend/src/components/game/arena/LeaderboardPanel.tsx` — rewrite
- `packages/frontend/src/components/charts/PortfolioSparkline.tsx` (new) — 240×24 SVG line, optional accent variant
- `packages/frontend/src/components/charts/portfolio-colors.ts` (new) — deterministic `playerId → cssVar` (`--p2`..`--p8`); current user always `--accent`
- `packages/frontend/src/api/leaderboard-history.ts` (new) — React Query hook `useLeaderboardHistory(gameId, range)`
- `packages/frontend/src/index.css` — add `--p2`..`--p8` palette tokens (light + dark)

### Component contract

```tsx
<LeaderboardPanel
  gameId={gameId}
  entries={leaderboard}            // current rank/value from useGame()
  startingBalance={...}
  initialRange="5d"
/>
```

Internal state:
- `range` (1D/5D/10D/ALL chip group)
- `expanded` (false = top-10 + pinned-you; true = full field)

Renders:
- Header: title + `5D` chip group + `Full view ↗` link to `/games/:id/leaderboard` + `● LIVE`
- Pinned "you" row (always, regardless of `expanded`)
- Column header row (#, Player, trend, Value, P&L, Δ24h)
- Top 10 rows, or all rows when `expanded`
- Footer: `▾ Show all 31 players (21 hidden · including you @ #25)` button. When you're already in top-10, the hint becomes `"21 hidden"`.

### Sparkline

Pure SVG (no chart library — `lightweight-charts` is too heavy for 31 instances). 240×24, normalised independently per row, dashed mid-line at the starting balance, end dot. Inputs: `{ points: Array<{ t: string; v: number }>; color: string; strokeWidth?: number }`. The hook returns one history payload per panel render; rows pick their series by `playerId`.

### Live updates

The existing `leaderboard_update` WS event carries the new `LeaderboardEntry[]`. Sparklines need an extra signal: a new `leaderboard_history_point` event broadcast from Phase 1's `recordSnapshot`. Payload: `{ gameId, points: Array<{ playerId, t, v, r }> }` — one row per player at the snapshot moment. The frontend's `liveStore` appends each point to the in-memory series cache keyed by `(gameId, playerId)`, and React Query reads from there for sparklines.

This is the only WS-protocol addition. Add it to `packages/shared/src/types/websocket.ts`.

### Δ24h

The 24-hour P&L delta is shown per row but isn't in the current `LeaderboardEntry`. Compute on the client from `points` (find the point closest to `now - 24h` and diff against the latest). Add a `delta24hPct` helper in `packages/frontend/src/components/game/arena/utils.ts`.

### Tests

- `LeaderboardPanel.test.tsx` — top-10 default, expand toggle, pinned-you visible in both states, hint text varies by user rank, `Full view ↗` href.
- `PortfolioSparkline.test.tsx` — renders correct number of points, dashed baseline at start value, end-dot at last value.

---

## Phase 4 — arena re-layout

**Goal:** physically move the panel from left rail to centre column.

### Files

- `packages/frontend/src/pages/GameDetailPage.tsx` — re-arrange the three columns

### Layout change

Before:
```
LEFT (280px)                CENTRE                          RIGHT (300px)
─ LeaderboardPanel          ─ QuoteHeader                   ─ SymbolSearchPanel
─ PortfolioPanel            ─ ChartPanel                    ─ WatchlistPanel
                            ─ OhlcStrip                     ─ ActivityPanel
                            ─ HoldingsPanel
```

After:
```
LEFT (280px)                CENTRE                          RIGHT (300px)
─ PortfolioPanel            ─ QuoteHeader                   ─ SymbolSearchPanel
─ WatchlistPanel            ─ ChartPanel                    ─ YouCard (new, compact)
─ ActivityPanel             ─ OhlcStrip                     ─ MoversPanel (new)
                            ─ HoldingsPanel
                            ─ LeaderboardPanel  ← moved
```

The left rail keeps the same width (no need to widen — Portfolio + Watchlist + Activity all fit happily at 280px). The right rail gets a new small `YouCard` (rank + value + Δ24h + a "open full leaderboard" button) plus a `MoversPanel` so the lost left-rail leaderboard visibility on long pages is partially preserved.

### YouCard (new component)

```
RANK    VALUE         Δ24H
#25     $100,000      +0.00%
[ Full leaderboard ↗ ]
```

`packages/frontend/src/components/game/arena/YouCard.tsx`. Reads from the same `useGame()` leaderboard payload — finds the entry where `playerId === currentUserId`. No new API call.

### MoversPanel (new component)

Top-5 movers in the last 24h, derived client-side from the history hook's payload. `packages/frontend/src/components/game/arena/MoversPanel.tsx`. Compact rows: `swatch · name · Δ% · rank change`.

### Tests

- Update the existing `GameDetailPage.test.tsx` to assert the new column composition.
- Snapshot test on the arena layout to catch accidental column drift.

---

## Phase 5 — `/games/:gameId/leaderboard` page

**Goal:** the dedicated page from the mockup's Option 02.

### Files

- `packages/frontend/src/pages/GameLeaderboardPage.tsx` (new)
- `packages/frontend/src/App.tsx` — add the route, lazy-imported like its siblings
- `packages/frontend/src/components/leaderboard/PortfolioRaceChart.tsx` (new) — the full-page chart
- `packages/frontend/src/components/leaderboard/Podium.tsx` (new)
- `packages/frontend/src/components/leaderboard/StandingsTable.tsx` (new)
- `packages/frontend/src/components/leaderboard/RaceHighlights.tsx` (new) — auto-generated event list

### Route

`/games/:gameId/leaderboard` — same `ProtectedRoute` + `AppShell` parent as `/games/:gameId`. Reuses `useGame(gameId)` for the current leaderboard + game metadata, plus `useLeaderboardHistory(gameId, range)` for the chart data.

### Chart implementation

Build the chart in plain SVG, not `lightweight-charts` (which is single-series-oriented and would fight us on 11+ overlayed lines, end-of-line labels, and the "field band").

- X axis: time, derived from `points[].t`
- Y axis: value, %P&L, or rank — `viewMode` state
- "Top 10 + you" mode (default): full-colour series for top 10 + current user; everyone else collapses into a single grey envelope polygon (5th–95th percentile).
- "All players" mode: every series in full colour.
- "Custom" mode: user clicks legend chips to mute/unmute.
- Range chips (1D/5D/10D/20D/ALL) drive the `range` argument to the history hook.
- Crosshair on hover: vertical line + a floating panel listing every series value at that timestamp.

The chart re-uses `portfolio-colors.ts` from Phase 3 so a player's colour is consistent between sparkline, chart, and movers.

### Standings table

Columns: `#, Player, Value, P&L, Δ24h, Cash, Positions, Peak rank, Best day, Worst day`.

`Peak rank`, `Best day`, `Worst day` are derived from the history payload (the latter two as a single-day diff series). No new endpoint needed.

### RaceHighlights

Client-side analysis of the history payload to surface notable events:
- Lead changes (`#1` swapped → "X took #1 from Y on D-3")
- Big rank drops (≥ 5 ranks within 48h)
- Tightness records (narrowest spread of the tournament)
- All-time peak per player

Implemented as a pure function `analyseHistory(series, gameStartDate): HighlightEvent[]`. Cap at 4–6 highlights, ordered by recency.

### Tests

- `GameLeaderboardPage.test.tsx` — auth gating, page renders for valid game.
- `PortfolioRaceChart.test.tsx` — `viewMode` toggles change rendered series; `range` chips refetch history; muting via legend hides a series.
- `analyseHistory.test.ts` — fixture-based highlight detection.

---

## Cross-cutting decisions

### Colour assignment

```ts
// packages/frontend/src/components/charts/portfolio-colors.ts
export const PLAYER_PALETTE = [
  'var(--p2)', 'var(--p3)', 'var(--p4)',
  'var(--p5)', 'var(--p6)', 'var(--p7)', 'var(--p8)',
] as const;

export function colorForPlayer(playerId: string, isCurrentUser: boolean): string {
  if (isCurrentUser) return 'var(--accent)';
  let h = 2166136261;
  for (let i = 0; i < playerId.length; i++) h = (h ^ playerId.charCodeAt(i)) * 16777619;
  return PLAYER_PALETTE[Math.abs(h) % PLAYER_PALETTE.length];
}
```

Same `playerId` → same colour everywhere, forever. Current user is always `--accent`.

### Token additions

`packages/frontend/src/index.css` — append to both `:root` (dark) and `html:not(.dark)` (light) blocks:

```css
--p2: #a78bfa;  /* violet */
--p3: #f59e0b;  /* amber  */
--p4: #f472b6;  /* pink   */
--p5: #34d399;  /* mint   */
--p6: #60a5fa;  /* blue   */
--p7: #fb7185;  /* rose   */
--p8: #facc15;  /* gold   */
```

Light-theme variants will be slightly desaturated/darkened to maintain contrast on `#ffffff`. Pick by eye during Phase 3.

### Reduced-motion compliance

The pinned "you" row pulses subtly on a rank change. Gate the pulse via `@media (prefers-reduced-motion: reduce)`, matching the existing `--pulse-dot` pattern in `index.css`.

### Accessibility

- Chart series are colour-coded **and** labelled at the right edge. Never colour-alone.
- Sparklines have `aria-label` containing the player name and current %P&L.
- Standings table uses real `<table>` markup with proper `<th>` scoping.
- Expand button uses `aria-expanded` + `aria-controls`.

### Performance budget

- Sparklines: 31 rows × 60 points = 1860 SVG line segments per panel render. Memoise each row; only re-render when its specific series changes. Use `React.memo` on the row component with `playerId` as the discriminator.
- History endpoint: LTTB-downsampled, bounded to `maxPoints`. A 31-player game with 30-day history at 5-min granularity = 31 × 8640 = 268k snapshot rows. The endpoint reads only one range slice and downsamples server-side, so the wire payload caps at 31 × 240 = 7440 points.
- WS `leaderboard_history_point` events: emitted at most every 5 min per game from the snapshot worker, plus one-shot on trade execution. Bounded.

### Tooling assist

`tools/seed-game-history` already populates synthetic trades over time. Once Phase 1 lands, run the seed tool and then **either** wait 5 minutes for natural snapshots **or** add a `--backfill-snapshots` flag that walks the synthetic trade timeline and emits historical snapshot rows. The flag is optional; without it the page just shows a flat baseline for old games, which is acceptable for development.

---

## Decisions (resolved 2026-05-20)

1. **Snapshot cadence:** 5 minutes (aligns with WS price-batch interval).
2. **Retention:** Compact ended games to daily granularity (one snapshot per player per game day, kept as last-of-day). Active games keep full 5-minute resolution. See Phase 1 → "Retention".
3. **Ended games:** Dedicated leaderboard page works for ended games, no archived treatment. History endpoint serves frozen post-compaction data.
4. **Field-band envelope:** Computed client-side. The server returns all 31 series; client derives the 5th–95th percentile polygon for the hidden subset whenever "Top 10 + you" mode is active. Legend mute/unmute is instant — no refetch.

---

## Branch hygiene

- One PR per phase preferred — but Phase 3 + 4 can land together since Phase 4 is mostly file moves that depend on Phase 3's new component.
- Don't merge Phase 4 (which removes the left-rail leaderboard) until Phase 3's centre-column panel is reviewed and visually verified in a browser.
- Phase 5 can land any time after Phase 2.
