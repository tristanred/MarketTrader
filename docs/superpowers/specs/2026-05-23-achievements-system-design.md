# Achievements System — Design Spec

**Status:** Draft
**Date:** 2026-05-23
**Scope:** Backend only. Frontend (panel, toast, hooks) is deferred — owner will design separately.

---

## Context

MarketTrader is a virtual stock-trading tournament. Players compete inside a game by trading real stocks at real prices. To make games stickier and more fun, we want to award **achievements** as players take actions or reach states inside a game — e.g., "place your first trade", "buy stocks 10 times", "reach a $20k portfolio", "be last on the leaderboard for 5 snapshots in a row".

Requirements driving this design:

- Achievements are **scoped to a single game** (no cross-game progress for v1).
- The system must detect progress **on the backend**, not by trusting client signals.
- The author API must make adding a new achievement **as easy as possible** — ideally creating one file and exporting it.
- Achievements have a **name** and a **numeric progress** value; boolean achievements are represented as 0/1 against target 1.
- Players will eventually view their progress on each achievement for a game.
- Achievements are **not exclusively trade-related** — examples include leaderboard standing over time and game-lifecycle events (joining, starting, ending).
- Achievements are **public within a game** — any member can see any other member's progress.

---

## Architecture

A new in-process, synchronous event bus connects existing domain services to a new achievement engine. Services emit typed events **after** their DB commit. The engine dispatches each event to handlers registered by code-defined achievements. Handlers manipulate progress through a small helper API; the engine handles persistence, idempotency, and the WebSocket broadcast.

```
trade.ts ──┐
snapshot ──┼─► EventBus ─► AchievementEngine ─► registered achievements
game ──────┘                       │
                                   ├─► achievement_progress table (one row per player + key)
                                   └─► WS broadcast: achievement_unlocked
```

### File layout

| Path | Purpose |
|---|---|
| `packages/server/src/events/bus.ts` | Typed in-process `EventEmitter` wrapper (`emit<T>`, `on<T>`) |
| `packages/server/src/events/types.ts` | `DomainEvent` discriminated union |
| `packages/server/src/achievements/define.ts` | `defineAchievement()` helper — narrows handler event types from the `events` literal array |
| `packages/server/src/achievements/engine.ts` | Subscribes to bus, dispatches to handlers, owns helper implementations |
| `packages/server/src/achievements/registry.ts` | Aggregates `definitions/*.ts` and exposes lookup by key |
| `packages/server/src/achievements/definitions/*.ts` | One file per achievement (the "easy to add" surface) |
| `packages/server/src/achievements/definitions/index.ts` | Re-exports all definitions; the only file edited when adding an achievement |
| `packages/server/src/services/achievement.ts` | Pure query functions: `getAchievementsForGame`, `getProgressForPlayer` |
| `packages/server/src/routes/achievements.ts` | Fastify route factory with Zod schemas |
| `packages/server/src/db/schema.sqlite.ts` and `schema.pg.ts` | Add the `achievement_progress` table |
| `packages/shared/src/types/achievement.ts` | DTOs for REST + the `achievement_unlocked` WS event |

### Wiring into existing services

Emits happen **after** the DB commit, next to the existing WebSocket broadcasts so the rollback semantics stay clean:

- `services/trade.ts` `executeTrade()` — emit `trade.executed` after the transaction returns, alongside the existing `trade_executed` WS broadcast.
- `services/portfolio-snapshot.ts` `recordSnapshot()` — emit `snapshot.recorded` after the row is inserted. The rank and total player count are already computed there.
- `recomputeGameStatus()` — emit `game.started` / `game.ended` when status transitions. Use the previous status as the dedup key so the emit fires at most once per transition.
- Join-game route — emit `player.joined` after the `gamePlayers` insert commits.
- `app.ts` — start a `setInterval(60_000)` that emits `engine.tick`. Clear on `onClose` hook.

---

## Author API

Each achievement is a single file under `packages/server/src/achievements/definitions/`. Adding one = create the file and export it from `definitions/index.ts`. No DB rows for definitions — code is the source of truth.

### Boolean (one-shot)

```ts
// definitions/first-trade.ts
import { defineAchievement } from '../define';

export default defineAchievement({
  key: 'first-trade',
  name: 'First Trade',
  description: 'Execute your first trade.',
  category: 'trading',
  target: 1,
  events: ['trade.executed'],
  onEvent(event, ctx) {
    ctx.unlock(event.gamePlayerId);
  },
});
```

### Counter (additive)

```ts
// definitions/ten-buys.ts
export default defineAchievement({
  key: 'ten-buys',
  name: 'Active Trader',
  description: 'Buy stocks 10 times.',
  target: 10,
  events: ['trade.executed'],
  onEvent(event, ctx) {
    if (event.direction === 'buy') ctx.increment(event.gamePlayerId, 1);
  },
});
```

### Streak (state with reset)

```ts
// definitions/rock-bottom.ts
export default defineAchievement({
  key: 'rock-bottom',
  name: 'Rock Bottom',
  description: 'Be last on the leaderboard for 5 snapshots in a row.',
  target: 5,
  events: ['snapshot.recorded'],
  async onEvent(event, ctx) {
    if (event.rank === event.totalPlayers) {
      await ctx.increment(event.gamePlayerId, 1);
    } else {
      await ctx.setProgress(event.gamePlayerId, 0);
    }
  },
});
```

### `ctx` helpers

- `ctx.unlock(gamePlayerId)` — sets progress to target and marks unlocked. No-op if already unlocked.
- `ctx.increment(gamePlayerId, n)` — atomic increment via `UPDATE … SET progress = progress + ? WHERE unlocked_at IS NULL`. Auto-unlocks when reaching target.
- `ctx.setProgress(gamePlayerId, n)` — absolute set (for streak resets and threshold-state achievements). No-op once unlocked.
- `ctx.getProgress(gamePlayerId)` — read the current row (creates a zero row if missing).
- `ctx.gameId`, `ctx.db` — passthrough escape hatches for unusual achievements that need extra queries.

### Engine guarantees so authors don't reimplement them

- **Idempotency.** Once `unlocked_at IS NOT NULL`, no helper mutates the row.
- **Atomicity.** Each helper call is a single SQL statement; concurrent events don't double-count.
- **Isolation.** Each handler is wrapped in `try/catch` with logging — one failing handler does not affect others (mirrors the WS handler convention in CLAUDE.md).
- **Broadcast.** When a helper transitions a row to unlocked, the engine emits `achievement_unlocked` over the existing `GameClientRegistry`.
- **Lazy row creation.** Rows are created on first helper call (upsert), not pre-seeded for every player × achievement.

### Registration

```ts
// definitions/index.ts
import firstTrade from './first-trade';
import tenBuys from './ten-buys';
import rockBottom from './rock-bottom';
export const achievements = [firstTrade, tenBuys, rockBottom];
```

The engine reads this list on boot, builds an `eventType → handlers[]` map, and subscribes to the bus.

---

## Data model

One new table.

```ts
export const achievementProgress = sqliteTable('achievement_progress', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  gameId: text('game_id').notNull().references(() => games.id, { onDelete: 'cascade' }),
  gamePlayerId: text('game_player_id').notNull().references(() => gamePlayers.id, { onDelete: 'cascade' }),
  achievementKey: text('achievement_key').notNull(),
  progress: integer('progress').notNull().default(0),
  target: integer('target').notNull(),
  unlockedAt: text('unlocked_at'),
  metadata: text('metadata', { mode: 'json' }),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => ({
  uniquePlayerAchievement: uniqueIndex('uq_progress_player_key').on(t.gamePlayerId, t.achievementKey),
  byGame: index('idx_progress_game').on(t.gameId),
}));
```

The PostgreSQL variant mirrors this with `timestamp` columns and `jsonb` for `metadata`, keeping the manual-sync convention used in the rest of `schema.pg.ts`.

Design notes:

- `(gamePlayerId, achievementKey)` is unique — one row per player per achievement.
- `target` is snapshotted into the row so changing a definition's target in code later does not retroactively un-unlock players.
- `achievementKey` is a string referring to the code-defined registry; if a definition is removed, orphaned rows are filtered out at read time from the player-facing route (admin view still shows them).
- `metadata` is an escape hatch for achievements that need additional state (last symbol seen, set of unique stocks, etc.).

### Game flag

Add `achievementsEnabled` boolean to the `games` table (default `true`) and to `CreateGameRequest` in `packages/shared/src/types/game.ts`, mirroring the existing `allowShortSelling` / `allowLimitOrders` pattern. The engine checks this flag before dispatching any handler for that game.

### Per-game per-achievement toggle

Add a small table `game_achievement_overrides`:

```ts
export const gameAchievementOverrides = sqliteTable('game_achievement_overrides', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  gameId: text('game_id').notNull().references(() => games.id, { onDelete: 'cascade' }),
  achievementKey: text('achievement_key').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => ({
  uniqueGameKey: uniqueIndex('uq_override_game_key').on(t.gameId, t.achievementKey),
}));
```

Absence of a row = use the global default (enabled). Presence overrides the global setting for that game only.

### Global per-achievement toggle

Stored in the existing `system_settings` table under key `achievements.disabled` as a JSON array of disabled achievement keys (e.g., `["rock-bottom"]`). Reuses the existing `SystemSettingsService` so no new schema is needed. The engine consults this before dispatching.

### Effective enabled-check order

When an event arrives, the engine dispatches a handler iff **all** of:
1. The achievement definition exists in the code registry.
2. The game's `achievementsEnabled` flag is `true`.
3. The achievement key is not in the global `achievements.disabled` settings array.
4. If a `game_achievement_overrides` row exists for `(gameId, key)`, its `enabled` value is `true`.

---

## Event payloads

`packages/shared/src/types/events.ts` (server-internal, **not** sent over WS):

```ts
export type DomainEvent =
  | { type: 'trade.executed'; gameId: string; gamePlayerId: string; symbol: string;
      direction: 'buy' | 'sell'; quantity: number; price: number; tradeId: string; executedAt: string }
  | { type: 'snapshot.recorded'; gameId: string; gamePlayerId: string; totalValue: number;
      rank: number; totalPlayers: number; capturedAt: string }
  | { type: 'game.started'; gameId: string; startedAt: string }
  | { type: 'game.ended';   gameId: string; endedAt: string;
      finalRanking: Array<{ gamePlayerId: string; rank: number; totalValue: number }> }
  | { type: 'player.joined'; gameId: string; gamePlayerId: string; userId: string; joinedAt: string }
  | { type: 'engine.tick';   at: string };
```

The bus uses `Promise.allSettled` to fan out so a slow or throwing handler doesn't block the originating request, while errors still get logged through Fastify's logger.

---

## REST + WebSocket API

### Player-facing REST (`routes/achievements.ts`)

- `GET /api/games/:gameId/achievements` — definitions merged with progress for all players in the game:
  ```ts
  {
    definitions: AchievementDefinitionDTO[],
    progress: Record<gamePlayerId, AchievementProgressDTO[]>,
  }
  ```
- `GET /api/games/:gameId/players/:gamePlayerId/achievements` — same shape, one player.

Both use Zod for params and follow the existing route-factory pattern in `routes/trading.ts`. Auth: caller must be a member of the game.

### Admin REST (`routes/admin/achievements.ts`)

All endpoints use the existing `requireAdmin` decorator and call `recordAdminAction()` after every mutation, matching `routes/admin/portfolios.ts`.

- `GET  /admin/games/:gameId/achievements` — definitions + every player's progress in one payload (admin-friendly inspection view; includes orphaned rows that the player-facing route filters out).
- `POST /admin/games/:gameId/players/:gamePlayerId/achievements/:key/unlock` — force unlock (progress → target, set `unlocked_at`).
- `POST /admin/games/:gameId/players/:gamePlayerId/achievements/:key/reset` — clear `unlocked_at`, set progress to 0.
- `PATCH /admin/games/:gameId/players/:gamePlayerId/achievements/:key` body `{ progress: number }` — set absolute progress; auto-unlocks if `progress ≥ target`.
- `PATCH /admin/games/:gameId/achievements/:key` body `{ enabled: boolean }` — per-game per-achievement enable/disable (see Enable/disable below).
- `PATCH /admin/achievements/:key` body `{ enabled: boolean }` — global per-achievement enable/disable, stored in `system_settings`.

All mutations write an `admin_audit_log` row with `action` strings: `achievement.unlock`, `achievement.reset`, `achievement.set_progress`, `achievement.set_enabled_game`, `achievement.set_enabled_global`.

### WebSocket

Add to `packages/shared/src/types/websocket.ts`:

```ts
export type WsAchievementUnlockedEvent = {
  type: 'achievement_unlocked';
  gamePlayerId: string;
  achievementKey: string;
  name: string;
  description: string;
  unlockedAt: string;
};
```

Broadcast via the existing `GameClientRegistry.broadcast(gameId, event)` — the same path as `trade_executed`.

---

## Testing

- **Engine unit tests** (`tests/achievements/engine.test.ts`) — instantiate the engine with a fake registry of 2–3 test achievements, emit events via the bus, assert DB rows. Cover row creation on first event, increment, unlock transition, idempotency after unlock, and isolation when one handler throws.
- **Helper tests** (`tests/achievements/helpers.test.ts`) — exercise `increment`, `setProgress`, `unlock` against in-memory SQLite. Cover concurrent increments (no double counting) and post-unlock no-ops.
- **Integration tests** (`tests/routes/achievements.test.ts`) — use `createTestApp()` with the real registry, execute a trade, assert the progress row appears and a WS broadcast frame is observed by a test client.
- **Per-achievement tests** (`tests/achievements/definitions/*.test.ts`) — one per definition file, mirroring the per-service test convention already used in the repo.

---

## Verification (end-to-end)

1. `pnpm --filter server db:generate` — review the migration adds `achievement_progress`.
2. `pnpm --filter server db:migrate`.
3. `pnpm --filter server test` — engine, helpers, per-achievement, and route tests pass.
4. `pnpm --filter server typecheck && pnpm lint`.
5. Manual smoke (backend only, no FE yet):
   - Register two users, create a game, both join, start trading.
   - `curl /api/games/:id/achievements` shows the `first-trade` row with `unlockedAt` set after the first trade.
   - Trigger or wait for a snapshot and confirm `rock-bottom`-style streak progress changes correctly.
   - Connect `wscat` to `/api/games/:id/live?token=…` and confirm an `achievement_unlocked` frame arrives the instant a target is hit.

---

## Out of scope (deferred)

- Frontend (panel, toast, React Query hook) — owner will design separately.
- Retroactive backfill when a new achievement is added — forward-only per the brainstorm.
- Cross-game / lifetime achievements — the table is keyed by `gameId` on purpose.
- Rarity, point values, or leaderboard weighting from achievements.

---

## Reused code references

- Route factory + Zod pattern: `packages/server/src/routes/trading.ts`
- Post-commit broadcast pattern: end of `executeTrade()` in `packages/server/src/services/trade.ts`
- Snapshot rank/totalPlayers source: `recordSnapshot()` in `packages/server/src/services/portfolio-snapshot.ts`
- WS broadcast surface: `GameClientRegistry` in `packages/server/src/ws/registry.ts`
- Test harness: `createTestApp()` used in `packages/server/tests/routes/trading.test.ts`
- Schema convention (sqlite + pg in sync): `packages/server/src/db/schema.{sqlite,pg}.ts`
- Admin auth + audit log: `requireAdmin` decorator and `recordAdminAction()` used throughout `packages/server/src/routes/admin/portfolios.ts`
- Game feature flag pattern: `allowShortSelling` / `allowLimitOrders` on the `games` table and `CreateGameRequest` in `packages/shared/src/types/game.ts`
- Global runtime setting pattern: `SystemSettingsService` used for ticker-tape symbols (`packages/server/src/services/system-settings.ts`)
