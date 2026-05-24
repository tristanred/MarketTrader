# Achievements Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the player-facing achievements UI (cards, toast, dedicated panel page) per `docs/superpowers/specs/2026-05-23-achievements-frontend-design.md`, including the small backend amendments the design depends on (rarity + icon fields, WS event additions, replay/ack mechanism for "show exactly once").

**Architecture:** Five layers, built in dependency order:
1. **Shared DTOs** gain `rarity` + `icon` + `replayed?` so frontend can render without follow-up fetches.
2. **Backend** — `defineAchievement` requires `rarity` + `icon`; existing 3 definitions migrated; `markUnlocked()` broadcast includes new fields; new `lastSeenUnlockAt` column on `gamePlayers`; WS connect replays missed unlocks; `POST …/ack` advances the high-water mark.
3. **Frontend foundations** — rarity tokens in CSS, `<AchievementCard>` shared chrome, icon lookup helper, React Query hook.
4. **Toast pipeline** — Zustand store with `(key, unlockedAt)` de-dup, localStorage marker, `useAchievementUnlockStream` hook wired into `useGameSocket`, `<AchievementToast>` + `<AchievementToastHost>` mounted in app shell.
5. **Page + roster + navigation** — `/games/:gameId/achievements` route with grid, filters, URL search-param sync, roster, single-player drilldown.

**Tech Stack:** TypeScript strict, React 19, Vite, Tailwind, shadcn primitives, Zustand, React Query v5, Drizzle (SQLite + Postgres), Fastify v5, `@fastify/websocket`, Lucide React (already installed), Vitest, Playwright.

---

## File Structure

### New files

```
packages/shared/src/types/achievement.ts                        # MODIFIED (add rarity, icon, replayed)
packages/server/drizzle/sqlite/00XX_game_players_last_seen.sql  # NEW migration
packages/server/drizzle/pg/00XX_game_players_last_seen.sql      # NEW migration
packages/server/src/db/schema.sqlite.ts                         # MODIFIED (add lastSeenUnlockAt column)
packages/server/src/db/schema.pg.ts                             # MODIFIED (add lastSeenUnlockAt column)
packages/server/src/achievements/define.ts                      # MODIFIED (rarity + icon required)
packages/server/src/achievements/definitions/{first-trade,ten-buys,rock-bottom}.ts  # MODIFIED (add rarity, icon)
packages/server/src/achievements/engine.ts                      # MODIFIED (broadcast includes rarity + icon)
packages/server/src/services/achievement.ts                     # MODIFIED (DTO mapping includes rarity, icon)
packages/server/src/ws/live-route.ts                            # MODIFIED (connect-time replay)
packages/server/src/ws/registry.ts                              # MODIFIED — add sendToSocket() helper
packages/server/src/routes/achievements.ts                      # MODIFIED — add POST /ack endpoint
packages/server/tests/achievements/{engine,definitions}.test.ts # MODIFIED — accept rarity + icon
packages/server/tests/routes/achievements.test.ts               # MODIFIED — cover ack + replay
packages/server/tests/ws/live-route-achievement-replay.test.ts  # NEW

packages/frontend/src/index.css                                 # MODIFIED — rarity CSS vars
packages/frontend/tailwind.config.ts                            # MODIFIED — expose rarity Tailwind colors + keyframes
packages/frontend/src/components/achievements/rarity.ts         # NEW
packages/frontend/src/components/achievements/icon.tsx          # NEW
packages/frontend/src/components/achievements/AchievementCard.tsx           # NEW
packages/frontend/src/components/achievements/AchievementToast.tsx          # NEW
packages/frontend/src/components/achievements/AchievementToast.module.css   # NEW (keyframes)
packages/frontend/src/components/achievements/AchievementToastHost.tsx      # NEW
packages/frontend/src/components/achievements/AchievementGrid.tsx           # NEW
packages/frontend/src/components/achievements/AchievementRoster.tsx         # NEW
packages/frontend/src/api/achievements.ts                                   # NEW (REST + query keys)
packages/frontend/src/hooks/useAchievements.ts                              # NEW
packages/frontend/src/hooks/useAchievementUnlockStream.ts                   # NEW
packages/frontend/src/stores/achievementToastStore.ts                       # NEW
packages/frontend/src/lib/achievementSeenMarker.ts                          # NEW
packages/frontend/src/pages/AchievementsPage.tsx                            # NEW
packages/frontend/src/hooks/useGameSocket.ts                                # MODIFIED — dispatch achievement_unlocked
packages/frontend/src/components/AppHeader.tsx                              # MODIFIED — add Achievements link
packages/frontend/src/components/shell/AppShell.tsx                         # MODIFIED — mount AchievementToastHost
packages/frontend/src/App.tsx                                               # MODIFIED — add route

packages/frontend/tests/components/achievements/AchievementCard.test.tsx    # NEW
packages/frontend/tests/components/achievements/AchievementToast.test.tsx   # NEW
packages/frontend/tests/stores/achievementToastStore.test.ts                # NEW
packages/frontend/tests/lib/achievementSeenMarker.test.ts                   # NEW
packages/frontend/tests/hooks/useAchievementUnlockStream.test.tsx           # NEW
packages/frontend/tests/pages/AchievementsPage.test.tsx                     # NEW
packages/frontend/tests/components/achievements/AchievementRoster.test.tsx  # NEW
```

The drizzle migration numbers (`00XX`) will be assigned by `pnpm --filter server db:generate` in Task 6 — don't hand-pick them.

---

## Task 1: Shared DTO — add `rarity` and `icon`

**Files:**
- Modify: `packages/shared/src/types/achievement.ts`

- [ ] **Step 1: Edit the shared DTO**

Replace the file's contents:

```ts
/**
 * Visual tier / scarcity. Drives the rarity color, halo intensity, and
 * sort order in the UI. Code-defined in `defineAchievement()`; never
 * stored in the database (definitions are the source of truth).
 */
export type AchievementRarity =
  | 'common'
  | 'uncommon'
  | 'rare'
  | 'epic'
  | 'legendary';

/**
 * Code-defined achievement metadata as exposed to the API. Definitions live
 * in the server's `achievements/definitions/` directory; this DTO is the
 * read-only projection sent to clients.
 */
export interface AchievementDefinitionDTO {
  /** Stable identifier matching `achievement_progress.achievement_key`. */
  key: string;
  name: string;
  description: string;
  /** Optional grouping label for UI presentation (e.g. 'trading', 'social'). */
  category?: string;
  /** Visual tier, drives rarity color in the UI. */
  rarity: AchievementRarity;
  /** Lucide icon name in kebab-case (e.g. 'flame', 'trending-up'). */
  icon: string;
  /** Numeric target. Boolean achievements use `target: 1`. */
  target: number;
  /** Effective enabled state for the queried game (after game flag + global setting + per-game override). */
  enabled: boolean;
}

/** Per-player progress on a single achievement, scoped to one game. */
export interface AchievementProgressDTO {
  achievementKey: string;
  gamePlayerId: string;
  progress: number;
  target: number;
  /** ISO 8601 timestamp. Null while progress < target. */
  unlockedAt: string | null;
}

/**
 * Pushed to all players in a game the moment another player unlocks an
 * achievement. Fields are denormalised so clients can render a toast without
 * a follow-up fetch. `replayed` distinguishes connect-time catch-up frames
 * from live unlocks — clients use it to adjust the eyebrow copy.
 */
export interface WsAchievementUnlockedEvent {
  event: 'achievement_unlocked';
  data: {
    gamePlayerId: string;
    achievementKey: string;
    name: string;
    description: string;
    rarity: AchievementRarity;
    icon: string;
    unlockedAt: string;
    /** True when sent from the WS connect-time replay loop. */
    replayed?: boolean;
  };
}
```

- [ ] **Step 2: Verify the shared package builds**

Run: `pnpm --filter shared build`
Expected: builds cleanly.

- [ ] **Step 3: Run typecheck on every package — it will fail in server**

Run: `pnpm typecheck`
Expected: server typecheck fails because `defineAchievement` callers now need `rarity` + `icon`, and the engine's `registry.broadcast()` payload is missing fields. Frontend typecheck currently passes (no consumer yet).

- [ ] **Step 4: Commit (deliberately leaving server broken — Task 2 fixes it)**

```bash
git add packages/shared/src/types/achievement.ts
git commit -m "feat(shared): add rarity + icon + replayed to achievement DTOs"
```

---

## Task 2: Backend definitions — `rarity` + `icon` as required fields

**Files:**
- Modify: `packages/server/src/achievements/define.ts`
- Modify: `packages/server/src/achievements/definitions/first-trade.ts`
- Modify: `packages/server/src/achievements/definitions/ten-buys.ts`
- Modify: `packages/server/src/achievements/definitions/rock-bottom.ts`

- [ ] **Step 1: Update `define.ts` to require `rarity` + `icon`**

In `packages/server/src/achievements/define.ts`, replace the import block at the top with:

```ts
import type { DomainEventOf, DomainEventType } from '../events/types.js';
import type { Db } from '../db/index.js';
import type { AchievementRarity } from '@markettrader/shared';

export type { AchievementRarity };
```

Then in `interface AchievementDefinition`, after the `category?: string;` line, add:

```ts
  /** Visual tier — drives rarity color in the UI. Required. */
  rarity: AchievementRarity;
  /** Lucide icon name (kebab-case, e.g. 'flame', 'trending-up'). Required. */
  icon: string;
```

And in `type AnyAchievementDefinition`, the `Omit<…>` already excludes only `events` and `onEvent`, so `rarity` and `icon` come along automatically.

- [ ] **Step 2: Update the three existing definitions**

In `packages/server/src/achievements/definitions/first-trade.ts`, locate the `defineAchievement({` block and insert after the `description:` line:

```ts
  rarity: 'common',
  icon: 'circle-dot',
```

In `packages/server/src/achievements/definitions/ten-buys.ts`, insert:

```ts
  rarity: 'uncommon',
  icon: 'repeat-2',
```

In `packages/server/src/achievements/definitions/rock-bottom.ts`, insert:

```ts
  rarity: 'epic',
  icon: 'trending-down',
```

- [ ] **Step 3: Run server typecheck — must pass now**

Run: `pnpm --filter server typecheck`
Expected: passes for definitions. May still fail in `engine.ts` because the broadcast payload doesn't yet include `rarity` + `icon`. That's Task 3.

- [ ] **Step 4: Run definitions test — confirm shape still validates**

Run: `pnpm --filter server test -- definitions`
Expected: existing tests for the three definitions pass. If a test asserts the DTO shape and fails on the missing fields, update the assertion to include `rarity` + `icon` for each definition.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/achievements/define.ts \
        packages/server/src/achievements/definitions/first-trade.ts \
        packages/server/src/achievements/definitions/ten-buys.ts \
        packages/server/src/achievements/definitions/rock-bottom.ts
git commit -m "feat(server): require rarity + icon on defineAchievement(); set on existing 3"
```

---

## Task 3: Engine broadcast includes `rarity` + `icon`

**Files:**
- Modify: `packages/server/src/achievements/engine.ts`
- Modify: `packages/server/tests/achievements/engine.test.ts`

- [ ] **Step 1: Add the failing test**

Open `packages/server/tests/achievements/engine.test.ts`. Find an existing test that asserts a `registry.broadcast` was called with `event: 'achievement_unlocked'`. Add a new assertion to it (or duplicate the test as `'broadcast includes rarity and icon'`):

```ts
expect(registry.broadcast).toHaveBeenCalledWith(
  expect.any(String),
  expect.objectContaining({
    event: 'achievement_unlocked',
    data: expect.objectContaining({
      rarity: expect.stringMatching(/^(common|uncommon|rare|epic|legendary)$/),
      icon: expect.any(String),
    }),
  }),
);
```

- [ ] **Step 2: Run the test, observe failure**

Run: `pnpm --filter server test -- engine`
Expected: FAIL — broadcast payload doesn't include `rarity` or `icon`.

- [ ] **Step 3: Edit `engine.ts` broadcast payload**

In `packages/server/src/achievements/engine.ts`, find the `if (unlocked) { this.registry.broadcast(gameId, {` block at line ~280 and replace the `data:` object with:

```ts
        data: {
          gamePlayerId,
          achievementKey: def.key,
          name: def.name,
          description: def.description,
          rarity: def.rarity,
          icon: def.icon,
          unlockedAt: now,
        },
```

- [ ] **Step 4: Run the test, expect green**

Run: `pnpm --filter server test -- engine`
Expected: PASS.

- [ ] **Step 5: Run full server test suite to verify nothing else regressed**

Run: `pnpm --filter server test`
Expected: PASS. If route tests fail on DTO shape, fix the assertions to include `rarity` + `icon`.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/achievements/engine.ts \
        packages/server/tests/achievements/engine.test.ts
git commit -m "feat(server): broadcast rarity + icon in achievement_unlocked WS event"
```

---

## Task 4: Service-layer DTO mapping includes `rarity` + `icon`

**Files:**
- Modify: `packages/server/src/services/achievement.ts`
- Modify: `packages/server/tests/routes/achievements.test.ts`

- [ ] **Step 1: Locate the DTO mapper**

Open `packages/server/src/services/achievement.ts`. Find the function(s) that build `AchievementDefinitionDTO` from a registry entry (likely `listDefinitionsForGame()` or similar). The function returns objects with `key, name, description, category, target, enabled` — it now needs `rarity` and `icon`.

- [ ] **Step 2: Update the mapper**

Add `rarity: def.rarity` and `icon: def.icon` to every object literal that builds a `AchievementDefinitionDTO`. There should be one mapper used by both player-facing and admin routes — if both routes hand-roll their own object, update each.

- [ ] **Step 3: Run route tests**

Run: `pnpm --filter server test -- achievements.test`
Expected: PASS. If a test snapshots the DTO and fails, regenerate or update the expected object to include `rarity` + `icon`.

- [ ] **Step 4: Add a positive assertion in `achievements.test.ts`**

In the test for `GET /api/games/:gameId/achievements`, add:

```ts
expect(body.definitions[0]).toMatchObject({
  rarity: expect.stringMatching(/^(common|uncommon|rare|epic|legendary)$/),
  icon: expect.any(String),
});
```

- [ ] **Step 5: Re-run, expect green**

Run: `pnpm --filter server test -- achievements.test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/achievement.ts \
        packages/server/tests/routes/achievements.test.ts
git commit -m "feat(server): include rarity + icon in achievement definition DTOs"
```

---

## Task 5: Schema — add `gamePlayers.lastSeenUnlockAt`

**Files:**
- Modify: `packages/server/src/db/schema.sqlite.ts`
- Modify: `packages/server/src/db/schema.pg.ts`

- [ ] **Step 1: Add the column to the SQLite schema**

In `packages/server/src/db/schema.sqlite.ts`, find the `gamePlayers` table definition (around line 134). Add a new column inside the columns object, after `joinedAt`:

```ts
    /**
     * High-water mark of the latest `unlocked_at` timestamp this player has
     * acknowledged seeing as a toast. Used by the WS connect-time replay to
     * avoid re-sending unlocks the player has already toasted. Advanced via
     * `POST /api/games/:gameId/players/:gamePlayerId/achievements/ack`.
     */
    lastSeenUnlockAt: text('last_seen_unlock_at'),
```

- [ ] **Step 2: Mirror in the PG schema**

In `packages/server/src/db/schema.pg.ts`, find the matching `gamePlayers` table. Add the same column, using `timestamp` instead of `text`:

```ts
    lastSeenUnlockAt: timestamp('last_seen_unlock_at', { mode: 'string', withTimezone: false }),
```

Match the casing/mode conventions of the surrounding columns in the file.

- [ ] **Step 3: Generate migrations**

Run: `pnpm --filter server db:generate`
Expected: produces two new migration files, one under `drizzle/sqlite/` and one under `drizzle/pg/`, each adding the column. Inspect both for `ALTER TABLE game_players ADD COLUMN last_seen_unlock_at`.

- [ ] **Step 4: Apply migrations to the local dev DB to sanity-check**

Run: `pnpm --filter server db:migrate`
Expected: applies cleanly, no errors.

- [ ] **Step 5: Run server tests (use in-memory SQLite, will auto-migrate)**

Run: `pnpm --filter server test`
Expected: PASS.

- [ ] **Step 6: Commit (include both schemas and both generated migrations)**

```bash
git add packages/server/src/db/schema.sqlite.ts \
        packages/server/src/db/schema.pg.ts \
        packages/server/drizzle/
git commit -m "feat(server): add game_players.last_seen_unlock_at column"
```

---

## Task 6: WS registry — add `sendToSocket()` helper

**Files:**
- Modify: `packages/server/src/ws/registry.ts`
- Modify: `packages/server/tests/ws/registry.test.ts` (if it exists; otherwise create it)

- [ ] **Step 1: Find the registry's current send shape**

Open `packages/server/src/ws/registry.ts`. The existing `broadcast(gameId, event)` sends to all sockets in a game. For replay we need to send to ONE socket (the one that just connected).

- [ ] **Step 2: Write a failing test**

Create or open `packages/server/tests/ws/registry.test.ts`. Add:

```ts
import { describe, expect, it, vi } from 'vitest';
import { GameClientRegistry } from '../../src/ws/registry.js';

describe('GameClientRegistry.sendToSocket', () => {
  it('sends only to the specified socket, not the whole game', () => {
    const reg = new GameClientRegistry();
    const a = { send: vi.fn(), readyState: 1 } as any;
    const b = { send: vi.fn(), readyState: 1 } as any;
    reg.add('g1', 'u1', a);
    reg.add('g1', 'u2', b);

    reg.sendToSocket(a, { event: 'price_update', data: [] });

    expect(a.send).toHaveBeenCalledOnce();
    expect(b.send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run, observe failure**

Run: `pnpm --filter server test -- ws/registry`
Expected: FAIL — `sendToSocket` not defined.

- [ ] **Step 4: Implement `sendToSocket`**

In `packages/server/src/ws/registry.ts`, add as a sibling method to `broadcast()`:

```ts
  /**
   * Sends one event to a single socket — used for unicast replay on connect.
   * Silently skips sockets in a non-OPEN state, matching `broadcast()`'s
   * fail-soft posture.
   */
  sendToSocket(socket: WebSocket, event: WsServerEvent): void {
    if (socket.readyState !== 1) return;
    try {
      socket.send(JSON.stringify(event));
    } catch {
      // socket may have closed between the readyState check and send
    }
  }
```

- [ ] **Step 5: Run test, expect green**

Run: `pnpm --filter server test -- ws/registry`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/ws/registry.ts \
        packages/server/tests/ws/registry.test.ts
git commit -m "feat(server): add GameClientRegistry.sendToSocket() for unicast replay"
```

---

## Task 7: WS connect-time replay of unacked unlocks

**Files:**
- Modify: `packages/server/src/ws/live-route.ts`
- Create: `packages/server/tests/ws/live-route-achievement-replay.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `packages/server/tests/ws/live-route-achievement-replay.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createTestApp } from '../helpers/test-app.js';

describe('WS connect-time achievement replay', () => {
  const ctx = createTestApp();
  afterAll(() => ctx.close());

  beforeEach(async () => {
    await ctx.reset();
  });

  it('replays unacked unlocks for the connecting player only', async () => {
    const { app, registerAndLogin, createGame, joinGame, port, db, schema } = ctx;
    const alice = await registerAndLogin('alice');
    const bob = await registerAndLogin('bob');
    const game = await createGame(alice);
    const alicePlayer = await joinGame(alice, game.id);
    const bobPlayer = await joinGame(bob, game.id);

    // Manually unlock an achievement for alice (bypass the engine to keep
    // the test focused on replay, not on which event fires which definition).
    await db.insert(schema.achievementProgress).values({
      gameId: game.id,
      gamePlayerId: alicePlayer.id,
      achievementKey: 'first-trade',
      progress: 1,
      target: 1,
      unlockedAt: new Date(Date.now() - 60_000).toISOString(),
    });

    // Connect alice's WS — should receive the replay frame.
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/api/games/${game.id}/live?token=${alice.token}`,
    );
    const messages: any[] = [];
    ws.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
    await new Promise<void>((resolve) => ws.once('open', () => resolve()));
    await new Promise((r) => setTimeout(r, 200));

    const replay = messages.find((m) => m.event === 'achievement_unlocked');
    expect(replay).toBeDefined();
    expect(replay.data).toMatchObject({
      achievementKey: 'first-trade',
      gamePlayerId: alicePlayer.id,
      replayed: true,
    });

    ws.close();
  });

  it('does not replay unlocks already acked (lastSeenUnlockAt advanced)', async () => {
    const { app, registerAndLogin, createGame, joinGame, port, db, schema } = ctx;
    const alice = await registerAndLogin('alice');
    const game = await createGame(alice);
    const alicePlayer = await joinGame(alice, game.id);
    const unlockedAt = new Date(Date.now() - 60_000).toISOString();
    await db.insert(schema.achievementProgress).values({
      gameId: game.id,
      gamePlayerId: alicePlayer.id,
      achievementKey: 'first-trade',
      progress: 1,
      target: 1,
      unlockedAt,
    });
    // Advance the marker to the unlock time.
    await db
      .update(schema.gamePlayers)
      .set({ lastSeenUnlockAt: unlockedAt })
      .where(eq(schema.gamePlayers.id, alicePlayer.id));

    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/api/games/${game.id}/live?token=${alice.token}`,
    );
    const messages: any[] = [];
    ws.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
    await new Promise<void>((resolve) => ws.once('open', () => resolve()));
    await new Promise((r) => setTimeout(r, 200));

    expect(messages.find((m) => m.event === 'achievement_unlocked')).toBeUndefined();
    ws.close();
  });
});
```

If `createTestApp()` doesn't already expose `port`, `db`, `schema`, `registerAndLogin`, `createGame`, `joinGame`, extend it (see `packages/server/tests/helpers/test-app.ts`). The existing route tests almost certainly use a similar pattern — mirror what they do.

- [ ] **Step 2: Run the test, observe failure**

Run: `pnpm --filter server test -- live-route-achievement-replay`
Expected: FAIL — no `achievement_unlocked` message arrives, because no replay code exists.

- [ ] **Step 3: Implement replay in `live-route.ts`**

In `packages/server/src/ws/live-route.ts`, the handler needs an `AchievementEngine` so it can resolve definitions for replay (we don't want to query the engine via REST). Update the exported factory to accept the engine, and the call site in `app.ts` accordingly.

First, refactor the signature:

```ts
import type { AchievementEngine } from '../achievements/engine.js';
// …
export function liveRoute(db: Db, registry: GameClientRegistry, engine: AchievementEngine) {
```

Then in the handler, after `registry.add(gameId, payload.id, socket);`, insert the replay block:

```ts
        // ── Connect-time achievement replay ────────────────────────────
        // Send any unlocks for this game-player whose unlocked_at is newer
        // than the high-water mark this player has acknowledged. We do NOT
        // advance the marker here — the client acks each toast on dismiss,
        // so a disconnect mid-replay re-replays on the next connect.
        try {
          const [{ lastSeenUnlockAt } = { lastSeenUnlockAt: null as string | null }] = await db
            .select({ lastSeenUnlockAt: schema.gamePlayers.lastSeenUnlockAt })
            .from(schema.gamePlayers)
            .where(eq(schema.gamePlayers.id, membership.id))
            .limit(1);
          const since = lastSeenUnlockAt ?? '1970-01-01T00:00:00.000Z';
          const missed = await db
            .select({
              achievementKey: schema.achievementProgress.achievementKey,
              unlockedAt: schema.achievementProgress.unlockedAt,
            })
            .from(schema.achievementProgress)
            .where(
              and(
                eq(schema.achievementProgress.gamePlayerId, membership.id),
                sql`${schema.achievementProgress.unlockedAt} IS NOT NULL`,
                sql`${schema.achievementProgress.unlockedAt} > ${since}`,
              ),
            )
            .orderBy(schema.achievementProgress.unlockedAt);

          for (const row of missed) {
            const def = engine.getDefinition(row.achievementKey);
            if (!def) continue; // orphaned (definition removed)
            registry.sendToSocket(socket, {
              event: 'achievement_unlocked',
              data: {
                gamePlayerId: membership.id,
                achievementKey: def.key,
                name: def.name,
                description: def.description,
                rarity: def.rarity,
                icon: def.icon,
                unlockedAt: row.unlockedAt!,
                replayed: true,
              },
            });
          }
        } catch (err) {
          app.log.error({ err, gameId, gamePlayerId: membership.id }, 'achievement replay failed');
          // Non-fatal — the user can still receive live unlocks.
        }
```

You also need to select `id` instead of just `id` on the membership query — the existing query already aliases `id`, so `membership.id` is available; if it isn't, expand the select.

Add `sql` to the imports if it isn't already there:

```ts
import { and, eq, sql } from 'drizzle-orm';
```

- [ ] **Step 4: Update `app.ts` to pass the engine**

In `packages/server/src/app.ts`, find the `liveRoute(db, registry)` call and change it to `liveRoute(db, registry, achievementEngine)`.

- [ ] **Step 5: Run the test, expect green**

Run: `pnpm --filter server test -- live-route-achievement-replay`
Expected: PASS for both cases.

- [ ] **Step 6: Run full server test suite — make sure nothing regressed**

Run: `pnpm --filter server test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/ws/live-route.ts \
        packages/server/src/app.ts \
        packages/server/tests/ws/live-route-achievement-replay.test.ts \
        packages/server/tests/helpers/
git commit -m "feat(server): replay unacked achievement unlocks on WS connect"
```

---

## Task 8: REST endpoint — `POST …/achievements/ack`

**Files:**
- Modify: `packages/server/src/routes/achievements.ts`
- Modify: `packages/server/tests/routes/achievements.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/server/tests/routes/achievements.test.ts`:

```ts
describe('POST /api/games/:gameId/players/:gamePlayerId/achievements/ack', () => {
  it('advances last_seen_unlock_at to the body timestamp', async () => {
    const { registerAndLogin, createGame, joinGame, app, db, schema } = ctx;
    const alice = await registerAndLogin('alice');
    const game = await createGame(alice);
    const player = await joinGame(alice, game.id);
    const ts = '2026-05-23T12:00:00.000Z';

    const res = await app.inject({
      method: 'POST',
      url: `/api/games/${game.id}/players/${player.id}/achievements/ack`,
      headers: { authorization: `Bearer ${alice.token}` },
      payload: { unlockedAt: ts },
    });

    expect(res.statusCode).toBe(204);
    const [row] = await db
      .select({ marker: schema.gamePlayers.lastSeenUnlockAt })
      .from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.id, player.id));
    expect(row.marker).toBe(ts);
  });

  it('is idempotent and never regresses the marker', async () => {
    const { registerAndLogin, createGame, joinGame, app, db, schema } = ctx;
    const alice = await registerAndLogin('alice');
    const game = await createGame(alice);
    const player = await joinGame(alice, game.id);
    const newer = '2026-05-23T12:00:00.000Z';
    const older = '2026-05-23T11:00:00.000Z';

    await app.inject({
      method: 'POST',
      url: `/api/games/${game.id}/players/${player.id}/achievements/ack`,
      headers: { authorization: `Bearer ${alice.token}` },
      payload: { unlockedAt: newer },
    });
    await app.inject({
      method: 'POST',
      url: `/api/games/${game.id}/players/${player.id}/achievements/ack`,
      headers: { authorization: `Bearer ${alice.token}` },
      payload: { unlockedAt: older },
    });

    const [row] = await db
      .select({ marker: schema.gamePlayers.lastSeenUnlockAt })
      .from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.id, player.id));
    expect(row.marker).toBe(newer);
  });

  it('returns 403 when ack-ing another player', async () => {
    const { registerAndLogin, createGame, joinGame, app } = ctx;
    const alice = await registerAndLogin('alice');
    const bob = await registerAndLogin('bob');
    const game = await createGame(alice);
    const alicePlayer = await joinGame(alice, game.id);
    await joinGame(bob, game.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/games/${game.id}/players/${alicePlayer.id}/achievements/ack`,
      headers: { authorization: `Bearer ${bob.token}` },
      payload: { unlockedAt: '2026-05-23T12:00:00.000Z' },
    });
    expect(res.statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Run the test, observe failure**

Run: `pnpm --filter server test -- achievements.test`
Expected: FAIL — endpoint returns 404 or similar.

- [ ] **Step 3: Implement the endpoint**

In `packages/server/src/routes/achievements.ts`, add to the existing route factory (after the GET routes):

```ts
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { schema } from '../db/index.js';

// inside the route registration function:
app.post<{
  Params: { gameId: string; gamePlayerId: string };
  Body: { unlockedAt: string };
}>(
  '/games/:gameId/players/:gamePlayerId/achievements/ack',
  {
    schema: {
      params: z.object({ gameId: z.string().uuid(), gamePlayerId: z.string().uuid() }),
      body: z.object({ unlockedAt: z.string().datetime() }),
    },
  },
  async (request, reply) => {
    const { gameId, gamePlayerId } = request.params;
    const { unlockedAt } = request.body;
    const userId = request.user.id;

    // Authz: caller must own this game-player row (or be admin — admins
    // already bypass via a different routing prefix, so the simple owner
    // check is sufficient here).
    const [player] = await db
      .select({ userId: schema.gamePlayers.userId, gameId: schema.gamePlayers.gameId })
      .from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.id, gamePlayerId))
      .limit(1);
    if (!player || player.gameId !== gameId) return reply.code(404).send();
    if (player.userId !== userId) return reply.code(403).send();

    // Greatest(current, body). SQLite has no GREATEST; emulate via CASE.
    await db
      .update(schema.gamePlayers)
      .set({
        lastSeenUnlockAt: sql`
          CASE
            WHEN ${schema.gamePlayers.lastSeenUnlockAt} IS NULL THEN ${unlockedAt}
            WHEN ${schema.gamePlayers.lastSeenUnlockAt} < ${unlockedAt} THEN ${unlockedAt}
            ELSE ${schema.gamePlayers.lastSeenUnlockAt}
          END
        `,
      })
      .where(eq(schema.gamePlayers.id, gamePlayerId));

    return reply.code(204).send();
  },
);
```

Match the route-factory signature, dependency-injection conventions, and Zod-validation patterns already used by other routes in the same file. The Zod compiler (`fastify-type-provider-zod` or whatever is in use) is configured in `app.ts`.

- [ ] **Step 4: Run the test, expect green**

Run: `pnpm --filter server test -- achievements.test`
Expected: PASS — all three new cases plus existing ones.

- [ ] **Step 5: Run full server test suite + typecheck + lint**

Run: `pnpm --filter server test && pnpm --filter server typecheck && pnpm --filter server lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/routes/achievements.ts \
        packages/server/tests/routes/achievements.test.ts
git commit -m "feat(server): POST /achievements/ack advances last_seen_unlock_at"
```

---

## Task 9: Frontend rarity tokens in CSS + Tailwind config

**Files:**
- Modify: `packages/frontend/src/index.css`
- Modify: `packages/frontend/tailwind.config.ts`

- [ ] **Step 1: Add rarity CSS vars to `index.css`**

In `packages/frontend/src/index.css`, inside the `:root` block (around line 7), after the `--p8` line and before the closing brace, add:

```css
    /* Achievement rarity tokens. See docs/superpowers/specs/2026-05-23-achievements-frontend-design.md */
    --r-common:    #9ca3af;
    --r-uncommon:  #34d399;
    --r-rare:      #60a5fa;
    --r-epic:      #a78bfa;
    --r-legendary: #f59e0b;
    --r-common-glow:    rgba(156, 163, 175, 0.06);
    --r-uncommon-glow:  rgba(52,  211, 153, 0.08);
    --r-rare-glow:      rgba(96,  165, 250, 0.10);
    --r-epic-glow:      rgba(167, 139, 250, 0.14);
    --r-legendary-glow: rgba(245, 158,  11, 0.18);
```

Add the SAME block (verbatim) inside the `.dark` block (it duplicates `:root` per file convention).

Inside `html:not(.dark)`, add the light-theme variants:

```css
    --r-common:    #6b7280;
    --r-uncommon:  #047857;
    --r-rare:      #1d4ed8;
    --r-epic:      #7c3aed;
    --r-legendary: #b45309;
    --r-common-glow:    rgba(107, 114, 128, 0.08);
    --r-uncommon-glow:  rgba(4,   120,  87, 0.10);
    --r-rare-glow:      rgba(29,   78, 216, 0.10);
    --r-epic-glow:      rgba(124,  58, 237, 0.12);
    --r-legendary-glow: rgba(180,  83,   9, 0.16);
```

- [ ] **Step 2: Add a `.rar-*` helper class block under `@layer utilities`**

In the same file, inside `@layer utilities`, append:

```css
  .rar-common    { --rarity: var(--r-common);    --rarity-glow: var(--r-common-glow); }
  .rar-uncommon  { --rarity: var(--r-uncommon);  --rarity-glow: var(--r-uncommon-glow); }
  .rar-rare      { --rarity: var(--r-rare);      --rarity-glow: var(--r-rare-glow); }
  .rar-epic      { --rarity: var(--r-epic);      --rarity-glow: var(--r-epic-glow); }
  .rar-legendary { --rarity: var(--r-legendary); --rarity-glow: var(--r-legendary-glow); }
```

- [ ] **Step 3: Add rarity colors + keyframes to `tailwind.config.ts`**

In `packages/frontend/tailwind.config.ts`, extend the `colors` block:

```ts
        rarity: {
          common: 'var(--r-common)',
          uncommon: 'var(--r-uncommon)',
          rare: 'var(--r-rare)',
          epic: 'var(--r-epic)',
          legendary: 'var(--r-legendary)',
        },
```

(Insert after the existing `'accent-foreground'` line.)

- [ ] **Step 4: Run the frontend build to confirm CSS compiles**

Run: `pnpm --filter frontend build`
Expected: PASS, no Tailwind warnings about unknown class names.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/index.css \
        packages/frontend/tailwind.config.ts
git commit -m "feat(frontend): add rarity CSS tokens + Tailwind rarity color scale"
```

---

## Task 10: Rarity helper module

**Files:**
- Create: `packages/frontend/src/components/achievements/rarity.ts`

- [ ] **Step 1: Create the helper**

Write `packages/frontend/src/components/achievements/rarity.ts`:

```ts
import type { AchievementRarity } from '@markettrader/shared';

/**
 * Display order — used for sorting cards in the grid: legendary first.
 * Mirrors the visual weight of rarities (rarer = more prominent).
 */
const RARITY_ORDER: Record<AchievementRarity, number> = {
  legendary: 0,
  epic: 1,
  rare: 2,
  uncommon: 3,
  common: 4,
};

/** Title-cased label, e.g. 'Legendary'. Used in the tier eyebrow. */
export function rarityLabel(rarity: AchievementRarity): string {
  return rarity.charAt(0).toUpperCase() + rarity.slice(1);
}

/** Tailwind className that sets --rarity and --rarity-glow via .rar-* utility. */
export function rarityClass(rarity: AchievementRarity): string {
  return `rar-${rarity}`;
}

/** Comparator suitable for Array.sort — legendary first. */
export function compareRarity(a: AchievementRarity, b: AchievementRarity): number {
  return RARITY_ORDER[a] - RARITY_ORDER[b];
}

/** Iteration order, e.g. for rendering filter chips. Legendary first. */
export const ALL_RARITIES: readonly AchievementRarity[] = [
  'legendary',
  'epic',
  'rare',
  'uncommon',
  'common',
];
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter frontend typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/achievements/rarity.ts
git commit -m "feat(frontend): rarity helper (label, class, comparator, ordering)"
```

---

## Task 11: Icon lookup helper

**Files:**
- Create: `packages/frontend/src/components/achievements/icon.tsx`

- [ ] **Step 1: Create the helper**

Write `packages/frontend/src/components/achievements/icon.tsx`:

```tsx
import { Award, type LucideIcon } from 'lucide-react';
import * as Icons from 'lucide-react';

/**
 * Resolves a Lucide kebab-case icon name (e.g. 'trending-up') to a Lucide
 * React component. Falls back to {@link Award} for unknown names and logs
 * once per missing name per session so authoring typos surface in devtools.
 */
const warned = new Set<string>();

export function getAchievementIcon(name: string): LucideIcon {
  const pascal = name
    .split('-')
    .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join('');
  const candidate = (Icons as unknown as Record<string, LucideIcon | undefined>)[pascal];
  if (candidate) return candidate;
  if (!warned.has(name)) {
    warned.add(name);
    // eslint-disable-next-line no-console
    console.warn(`[achievements] Unknown Lucide icon "${name}" — falling back to Award.`);
  }
  return Award;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter frontend typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/achievements/icon.tsx
git commit -m "feat(frontend): Lucide icon lookup helper with fallback"
```

---

## Task 12: `<AchievementCard>` component

**Files:**
- Create: `packages/frontend/src/components/achievements/AchievementCard.tsx`
- Create: `packages/frontend/tests/components/achievements/AchievementCard.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/frontend/tests/components/achievements/AchievementCard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AchievementCard } from '@/components/achievements/AchievementCard';
import type { AchievementDefinitionDTO, AchievementProgressDTO } from '@markettrader/shared';

const def: AchievementDefinitionDTO = {
  key: 'first-trade',
  name: 'First Trade',
  description: 'Execute your first trade.',
  rarity: 'common',
  icon: 'circle-dot',
  target: 1,
  enabled: true,
};

describe('AchievementCard', () => {
  it('renders name, description, and rarity tier label', () => {
    render(<AchievementCard definition={def} progress={null} />);
    expect(screen.getByText('First Trade')).toBeInTheDocument();
    expect(screen.getByText('Execute your first trade.')).toBeInTheDocument();
    expect(screen.getByText('Common')).toBeInTheDocument();
  });

  it('applies the rarity class for the given rarity', () => {
    const { container } = render(<AchievementCard definition={{ ...def, rarity: 'legendary' }} progress={null} />);
    expect(container.firstChild).toHaveClass('rar-legendary');
  });

  it('renders LOCKED tier label and muted styling when progress is null/zero', () => {
    const { container } = render(<AchievementCard definition={def} progress={null} />);
    expect(screen.getByText('Locked')).toBeInTheDocument();
    // The locked card should NOT have the rarity class — it's neutral.
    expect(container.firstChild).not.toHaveClass('rar-common');
  });

  it('renders progress count for in-progress achievements', () => {
    const progress: AchievementProgressDTO = {
      achievementKey: 'first-trade',
      gamePlayerId: 'gp1',
      progress: 4,
      target: 10,
      unlockedAt: null,
    };
    render(<AchievementCard definition={{ ...def, target: 10 }} progress={progress} />);
    expect(screen.getByText('4 / 10')).toBeInTheDocument();
  });

  it('renders "unlocked · {time}" for unlocked achievements', () => {
    const progress: AchievementProgressDTO = {
      achievementKey: 'first-trade',
      gamePlayerId: 'gp1',
      progress: 1,
      target: 1,
      unlockedAt: new Date(Date.now() - 60_000).toISOString(),
    };
    render(<AchievementCard definition={def} progress={progress} />);
    expect(screen.getByText(/unlocked/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, observe failure**

Run: `pnpm --filter frontend test -- AchievementCard`
Expected: FAIL — component doesn't exist.

- [ ] **Step 3: Implement the component**

Create `packages/frontend/src/components/achievements/AchievementCard.tsx`:

```tsx
import { cn } from '@/lib/utils';
import { getAchievementIcon } from './icon';
import { rarityClass, rarityLabel } from './rarity';
import type {
  AchievementDefinitionDTO,
  AchievementProgressDTO,
} from '@markettrader/shared';

export interface AchievementCardProps {
  definition: AchievementDefinitionDTO;
  /** Player's progress on this achievement; null = never touched (treat as 0/target). */
  progress: AchievementProgressDTO | null;
  /** Controls padding + icon size; default 'grid'. */
  variant?: 'grid' | 'toast' | 'roster';
  className?: string;
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Shared chrome for a single achievement, used by the grid and the toast.
 * The toast variant uses larger paddings and a wider icon; otherwise
 * identical so the visual language stays one card from anywhere.
 */
export function AchievementCard({ definition, progress, variant = 'grid', className }: AchievementCardProps) {
  const Icon = getAchievementIcon(definition.icon);
  const current = progress?.progress ?? 0;
  const unlocked = Boolean(progress?.unlockedAt);
  const isLocked = !unlocked && current === 0;
  const fillPct = unlocked ? 100 : Math.min(100, Math.round((current / definition.target) * 100));

  const tierLabel = isLocked
    ? 'Locked'
    : unlocked
      ? rarityLabel(definition.rarity)
      : `In progress · ${rarityLabel(definition.rarity)}`;

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-panel border border-hairline-strong bg-panel',
        'grid items-start gap-3',
        variant === 'toast' ? 'p-4 grid-cols-[34px_1fr_auto]' : 'px-4 py-3 grid-cols-[28px_1fr]',
        !isLocked && rarityClass(definition.rarity),
        isLocked && 'opacity-55',
        !unlocked && current > 0 && 'opacity-85',
        className,
      )}
    >
      {/* Rarity left bar */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: isLocked ? 'var(--hairline-strong)' : 'var(--rarity)' }}
      />
      {/* Rarity halo (top fade) */}
      {!isLocked && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: 'radial-gradient(120% 70% at 50% -20%, var(--rarity-glow) 0%, transparent 60%)',
          }}
        />
      )}
      <span
        className="relative z-[1] flex items-center justify-center"
        style={{ color: isLocked ? 'var(--muted)' : 'var(--rarity)' }}
      >
        <Icon width={variant === 'toast' ? 26 : 22} height={variant === 'toast' ? 26 : 22} strokeWidth={1.6} />
      </span>
      <div className="relative z-[1] min-w-0">
        <div
          className="font-mono text-[9px] uppercase tracking-[0.22em] mb-1"
          style={{ color: isLocked ? 'var(--muted)' : 'var(--rarity)' }}
        >
          {tierLabel}
        </div>
        <div className="font-semibold text-text-strong leading-tight" style={{ fontSize: variant === 'toast' ? 15 : 13 }}>
          {definition.name}
        </div>
        <div className="text-[11px] text-muted leading-[1.3] mt-0.5">{definition.description}</div>
        <div className="mt-2.5 flex items-center gap-2">
          <div className="flex-1 h-[3px] rounded-[2px] overflow-hidden" style={{ background: 'var(--hairline)' }}>
            <div className="h-full rounded-[2px]" style={{ width: `${fillPct}%`, background: isLocked ? 'var(--hairline)' : 'var(--rarity)' }} />
          </div>
          <div className="font-mono text-[10px] text-muted tabular-nums">
            {unlocked
              ? `unlocked · ${relativeTime(progress!.unlockedAt!)}`
              : `${current} / ${definition.target}`}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests, expect green**

Run: `pnpm --filter frontend test -- AchievementCard`
Expected: PASS for all five cases.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/achievements/AchievementCard.tsx \
        packages/frontend/tests/components/achievements/AchievementCard.test.tsx
git commit -m "feat(frontend): <AchievementCard> with locked / in-progress / unlocked states"
```

---

## Task 13: Achievement REST client + React Query hook

**Files:**
- Create: `packages/frontend/src/api/achievements.ts`
- Create: `packages/frontend/src/hooks/useAchievements.ts`

- [ ] **Step 1: Write the API client**

Create `packages/frontend/src/api/achievements.ts`:

```ts
import { api } from '@/lib/api';
import type { AchievementDefinitionDTO, AchievementProgressDTO } from '@markettrader/shared';

/** Server payload for `GET /api/games/:gameId/achievements`. */
export interface GameAchievementsResponse {
  definitions: AchievementDefinitionDTO[];
  /** Keyed by gamePlayerId. Each player has one entry per definition they've touched. */
  progress: Record<string, AchievementProgressDTO[]>;
}

/** Server payload for the per-player variant. */
export interface PlayerAchievementsResponse {
  definitions: AchievementDefinitionDTO[];
  progress: AchievementProgressDTO[];
}

export const achievementKeys = {
  all: ['achievements'] as const,
  game: (gameId: string) => ['achievements', gameId, 'all'] as const,
  player: (gameId: string, gamePlayerId: string) => ['achievements', gameId, gamePlayerId] as const,
};

export async function getGameAchievements(gameId: string): Promise<GameAchievementsResponse> {
  return api.get(`/api/games/${gameId}/achievements`);
}

export async function getPlayerAchievements(
  gameId: string,
  gamePlayerId: string,
): Promise<PlayerAchievementsResponse> {
  return api.get(`/api/games/${gameId}/players/${gamePlayerId}/achievements`);
}

/** POST the ack so the server advances `last_seen_unlock_at`. Idempotent. */
export async function ackAchievementUnlock(
  gameId: string,
  gamePlayerId: string,
  unlockedAt: string,
): Promise<void> {
  await api.post(`/api/games/${gameId}/players/${gamePlayerId}/achievements/ack`, { unlockedAt });
}
```

If `@/lib/api` doesn't expose `.get`/`.post` exactly as shown, match the conventions of e.g. `packages/frontend/src/api/games.ts`.

- [ ] **Step 2: Write the React Query hook**

Create `packages/frontend/src/hooks/useAchievements.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import {
  achievementKeys,
  getGameAchievements,
  getPlayerAchievements,
  type GameAchievementsResponse,
  type PlayerAchievementsResponse,
} from '@/api/achievements';

/**
 * Fetches achievement definitions + progress for a game. If `gamePlayerId`
 * is provided, returns the per-player view (smaller payload); otherwise
 * returns progress keyed by every player in the game (used by the roster).
 */
export function useAchievements(gameId: string): { data: GameAchievementsResponse | undefined; isLoading: boolean };
export function useAchievements(gameId: string, gamePlayerId: string): { data: PlayerAchievementsResponse | undefined; isLoading: boolean };
export function useAchievements(gameId: string, gamePlayerId?: string) {
  return useQuery({
    queryKey: gamePlayerId
      ? achievementKeys.player(gameId, gamePlayerId)
      : achievementKeys.game(gameId),
    queryFn: () =>
      gamePlayerId ? getPlayerAchievements(gameId, gamePlayerId) : getGameAchievements(gameId),
    staleTime: 30_000,
    enabled: Boolean(gameId),
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter frontend typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/api/achievements.ts \
        packages/frontend/src/hooks/useAchievements.ts
git commit -m "feat(frontend): achievement REST client + useAchievements query hook"
```

---

## Task 14: `achievementSeenMarker` (localStorage helper)

**Files:**
- Create: `packages/frontend/src/lib/achievementSeenMarker.ts`
- Create: `packages/frontend/tests/lib/achievementSeenMarker.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/frontend/tests/lib/achievementSeenMarker.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { getSeenMarker, advanceSeenMarker, isAlreadySeen } from '@/lib/achievementSeenMarker';

describe('achievementSeenMarker', () => {
  beforeEach(() => localStorage.clear());

  it('returns null when no marker has been stored', () => {
    expect(getSeenMarker('g1', 'p1')).toBeNull();
  });

  it('advances and reads back the marker', () => {
    advanceSeenMarker('g1', 'p1', '2026-05-23T12:00:00.000Z');
    expect(getSeenMarker('g1', 'p1')).toBe('2026-05-23T12:00:00.000Z');
  });

  it('never regresses to an older timestamp', () => {
    advanceSeenMarker('g1', 'p1', '2026-05-23T12:00:00.000Z');
    advanceSeenMarker('g1', 'p1', '2026-05-23T11:00:00.000Z');
    expect(getSeenMarker('g1', 'p1')).toBe('2026-05-23T12:00:00.000Z');
  });

  it('keeps separate markers per (gameId, gamePlayerId)', () => {
    advanceSeenMarker('g1', 'p1', '2026-05-23T12:00:00.000Z');
    advanceSeenMarker('g2', 'p1', '2026-05-23T10:00:00.000Z');
    expect(getSeenMarker('g1', 'p1')).toBe('2026-05-23T12:00:00.000Z');
    expect(getSeenMarker('g2', 'p1')).toBe('2026-05-23T10:00:00.000Z');
  });

  it('isAlreadySeen returns true when the incoming unlock is <= marker', () => {
    advanceSeenMarker('g1', 'p1', '2026-05-23T12:00:00.000Z');
    expect(isAlreadySeen('g1', 'p1', '2026-05-23T11:00:00.000Z')).toBe(true);
    expect(isAlreadySeen('g1', 'p1', '2026-05-23T12:00:00.000Z')).toBe(true);
    expect(isAlreadySeen('g1', 'p1', '2026-05-23T13:00:00.000Z')).toBe(false);
  });

  it('isAlreadySeen returns false when no marker exists', () => {
    expect(isAlreadySeen('g1', 'p1', '2026-05-23T12:00:00.000Z')).toBe(false);
  });
});
```

- [ ] **Step 2: Run, observe failure**

Run: `pnpm --filter frontend test -- achievementSeenMarker`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `packages/frontend/src/lib/achievementSeenMarker.ts`:

```ts
/**
 * Client-side high-water mark of the latest unlock the player has seen as a
 * toast. Belt-and-braces against re-toasting on WS reconnect / page refresh /
 * React StrictMode double-mount. Keyed by (gameId, gamePlayerId) so multiple
 * games on the same browser don't bleed into each other.
 *
 * See docs/superpowers/specs/2026-05-23-achievements-frontend-design.md
 * → "Showing each unlock exactly once" → Layer 2.
 */

function key(gameId: string, gamePlayerId: string): string {
  return `last_seen_unlock_at:${gameId}:${gamePlayerId}`;
}

export function getSeenMarker(gameId: string, gamePlayerId: string): string | null {
  try {
    return localStorage.getItem(key(gameId, gamePlayerId));
  } catch {
    return null; // private browsing / SSR / quota exceeded
  }
}

/**
 * Atomically advances the marker to `unlockedAt` iff it's strictly newer than
 * the current value. Never regresses.
 */
export function advanceSeenMarker(gameId: string, gamePlayerId: string, unlockedAt: string): void {
  try {
    const current = localStorage.getItem(key(gameId, gamePlayerId));
    if (current === null || current < unlockedAt) {
      localStorage.setItem(key(gameId, gamePlayerId), unlockedAt);
    }
  } catch {
    // ignore — non-fatal, server-side ack + replay still de-dups
  }
}

/** True when the incoming unlock has already been displayed. */
export function isAlreadySeen(gameId: string, gamePlayerId: string, unlockedAt: string): boolean {
  const marker = getSeenMarker(gameId, gamePlayerId);
  return marker !== null && unlockedAt <= marker;
}
```

- [ ] **Step 4: Run tests, expect green**

Run: `pnpm --filter frontend test -- achievementSeenMarker`
Expected: PASS for all six cases.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/lib/achievementSeenMarker.ts \
        packages/frontend/tests/lib/achievementSeenMarker.test.ts
git commit -m "feat(frontend): achievementSeenMarker — localStorage high-water mark for toast de-dup"
```

---

## Task 15: `achievementToastStore` (Zustand)

**Files:**
- Create: `packages/frontend/src/stores/achievementToastStore.ts`
- Create: `packages/frontend/tests/stores/achievementToastStore.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/frontend/tests/stores/achievementToastStore.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { useAchievementToastStore } from '@/stores/achievementToastStore';
import type { WsAchievementUnlockedEvent } from '@markettrader/shared';

const unlockA: WsAchievementUnlockedEvent['data'] = {
  gamePlayerId: 'gp1',
  achievementKey: 'first-trade',
  name: 'First Trade',
  description: 'Execute your first trade.',
  rarity: 'common',
  icon: 'circle-dot',
  unlockedAt: '2026-05-23T12:00:00.000Z',
};

const unlockB = { ...unlockA, achievementKey: 'ten-buys', unlockedAt: '2026-05-23T12:01:00.000Z' };

describe('achievementToastStore', () => {
  beforeEach(() => useAchievementToastStore.setState({ current: null, queue: [] }));

  it('enqueue with empty queue + null current promotes immediately to current', () => {
    useAchievementToastStore.getState().enqueue(unlockA);
    const { current, queue } = useAchievementToastStore.getState();
    expect(current?.unlock.achievementKey).toBe('first-trade');
    expect(queue).toHaveLength(0);
  });

  it('enqueue with a current toast appends to the queue', () => {
    useAchievementToastStore.getState().enqueue(unlockA);
    useAchievementToastStore.getState().enqueue(unlockB);
    const { current, queue } = useAchievementToastStore.getState();
    expect(current?.unlock.achievementKey).toBe('first-trade');
    expect(queue).toHaveLength(1);
    expect(queue[0].unlock.achievementKey).toBe('ten-buys');
  });

  it('de-dups by (achievementKey, unlockedAt)', () => {
    useAchievementToastStore.getState().enqueue(unlockA);
    useAchievementToastStore.getState().enqueue({ ...unlockA });
    const { current, queue } = useAchievementToastStore.getState();
    expect(current).not.toBeNull();
    expect(queue).toHaveLength(0);
  });

  it('dismiss promotes the next queued toast into current', () => {
    useAchievementToastStore.getState().enqueue(unlockA);
    useAchievementToastStore.getState().enqueue(unlockB);
    const firstId = useAchievementToastStore.getState().current!.id;
    useAchievementToastStore.getState().dismiss(firstId);
    const { current, queue } = useAchievementToastStore.getState();
    expect(current?.unlock.achievementKey).toBe('ten-buys');
    expect(queue).toHaveLength(0);
  });

  it('dismiss on an outdated id (e.g. user clicks ×) is a no-op', () => {
    useAchievementToastStore.getState().enqueue(unlockA);
    useAchievementToastStore.getState().dismiss('not-a-real-id');
    expect(useAchievementToastStore.getState().current).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run, observe failure**

Run: `pnpm --filter frontend test -- achievementToastStore`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

Create `packages/frontend/src/stores/achievementToastStore.ts`:

```ts
import { create } from 'zustand';
import type { WsAchievementUnlockedEvent } from '@markettrader/shared';

export interface AchievementToast {
  id: string;
  unlock: WsAchievementUnlockedEvent['data'];
  enqueuedAt: number;
}

interface AchievementToastStore {
  current: AchievementToast | null;
  queue: AchievementToast[];
  enqueue(unlock: WsAchievementUnlockedEvent['data']): void;
  dismiss(id: string): void;
}

function dedupKey(u: WsAchievementUnlockedEvent['data']): string {
  return `${u.achievementKey}:${u.unlockedAt}`;
}

/**
 * Strict serial queue for own-unlock toasts. The host displays `current`;
 * `dismiss(id)` promotes the head of `queue` into `current`. Enqueues that
 * match an existing (key, unlockedAt) are dropped — protects against
 * StrictMode double-mounts, WS reconnect replays, and multi-tab races.
 */
export const useAchievementToastStore = create<AchievementToastStore>((set, get) => ({
  current: null,
  queue: [],
  enqueue(unlock) {
    const { current, queue } = get();
    const k = dedupKey(unlock);
    if (current && dedupKey(current.unlock) === k) return;
    if (queue.some((t) => dedupKey(t.unlock) === k)) return;
    const entry: AchievementToast = {
      id: crypto.randomUUID(),
      unlock,
      enqueuedAt: Date.now(),
    };
    if (current === null) {
      set({ current: entry });
    } else {
      set({ queue: [...queue, entry] });
    }
  },
  dismiss(id) {
    const { current, queue } = get();
    if (!current || current.id !== id) return;
    const [next, ...rest] = queue;
    set({ current: next ?? null, queue: rest });
  },
}));
```

- [ ] **Step 4: Run tests, expect green**

Run: `pnpm --filter frontend test -- achievementToastStore`
Expected: PASS for all five cases.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/stores/achievementToastStore.ts \
        packages/frontend/tests/stores/achievementToastStore.test.ts
git commit -m "feat(frontend): achievementToastStore — serial queue with (key, time) dedup"
```

---

## Task 16: `useAchievementUnlockStream` hook

**Files:**
- Create: `packages/frontend/src/hooks/useAchievementUnlockStream.ts`
- Create: `packages/frontend/tests/hooks/useAchievementUnlockStream.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/frontend/tests/hooks/useAchievementUnlockStream.test.tsx`:

```tsx
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAchievementUnlockStream } from '@/hooks/useAchievementUnlockStream';
import { useAchievementToastStore } from '@/stores/achievementToastStore';
import { advanceSeenMarker } from '@/lib/achievementSeenMarker';
import type { WsAchievementUnlockedEvent } from '@markettrader/shared';

const baseUnlock: WsAchievementUnlockedEvent['data'] = {
  gamePlayerId: 'gp1',
  achievementKey: 'first-trade',
  name: 'First Trade',
  description: 'Execute your first trade.',
  rarity: 'common',
  icon: 'circle-dot',
  unlockedAt: '2026-05-23T12:00:00.000Z',
};

describe('useAchievementUnlockStream', () => {
  beforeEach(() => {
    localStorage.clear();
    useAchievementToastStore.setState({ current: null, queue: [] });
  });
  afterEach(() => vi.restoreAllMocks());

  it('enqueues own-unlocks via the global hook bridge', () => {
    const { result } = renderHook(() => useAchievementUnlockStream('g1', 'gp1'));
    act(() => result.current.handle(baseUnlock));
    expect(useAchievementToastStore.getState().current?.unlock.achievementKey).toBe('first-trade');
  });

  it('drops peer unlocks (different gamePlayerId)', () => {
    const { result } = renderHook(() => useAchievementUnlockStream('g1', 'gp1'));
    act(() => result.current.handle({ ...baseUnlock, gamePlayerId: 'gp2' }));
    expect(useAchievementToastStore.getState().current).toBeNull();
  });

  it('drops unlocks <= localStorage marker', () => {
    advanceSeenMarker('g1', 'gp1', baseUnlock.unlockedAt);
    const { result } = renderHook(() => useAchievementUnlockStream('g1', 'gp1'));
    act(() => result.current.handle(baseUnlock));
    expect(useAchievementToastStore.getState().current).toBeNull();
  });

  it('enqueues unlocks newer than the marker', () => {
    advanceSeenMarker('g1', 'gp1', '2026-05-23T11:00:00.000Z');
    const { result } = renderHook(() => useAchievementUnlockStream('g1', 'gp1'));
    act(() => result.current.handle(baseUnlock));
    expect(useAchievementToastStore.getState().current?.unlock.achievementKey).toBe('first-trade');
  });
});
```

- [ ] **Step 2: Run, observe failure**

Run: `pnpm --filter frontend test -- useAchievementUnlockStream`
Expected: FAIL — hook not found.

- [ ] **Step 3: Implement the hook**

Create `packages/frontend/src/hooks/useAchievementUnlockStream.ts`:

```ts
import { useCallback } from 'react';
import { useAchievementToastStore } from '@/stores/achievementToastStore';
import { isAlreadySeen } from '@/lib/achievementSeenMarker';
import type { WsAchievementUnlockedEvent } from '@markettrader/shared';

interface UseAchievementUnlockStreamApi {
  /**
   * Call this with the `data` payload of an incoming achievement_unlocked
   * WS frame. The hook filters peer unlocks and previously-seen unlocks,
   * then enqueues the rest on the toast store.
   */
  handle(unlock: WsAchievementUnlockedEvent['data']): void;
}

/**
 * Bridges the per-game WebSocket to the achievement toast store. Returns a
 * stable `handle` callback that `useGameSocket` calls for each inbound
 * achievement_unlocked frame.
 */
export function useAchievementUnlockStream(
  gameId: string,
  myGamePlayerId: string | null,
): UseAchievementUnlockStreamApi {
  const enqueue = useAchievementToastStore((s) => s.enqueue);

  const handle = useCallback(
    (unlock: WsAchievementUnlockedEvent['data']) => {
      if (!myGamePlayerId) return;
      if (unlock.gamePlayerId !== myGamePlayerId) return;
      if (isAlreadySeen(gameId, myGamePlayerId, unlock.unlockedAt)) return;
      enqueue(unlock);
    },
    [gameId, myGamePlayerId, enqueue],
  );

  return { handle };
}
```

- [ ] **Step 4: Run tests, expect green**

Run: `pnpm --filter frontend test -- useAchievementUnlockStream`
Expected: PASS for all four cases.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/hooks/useAchievementUnlockStream.ts \
        packages/frontend/tests/hooks/useAchievementUnlockStream.test.tsx
git commit -m "feat(frontend): useAchievementUnlockStream — own-only + seen-marker gating"
```

---

## Task 17: Wire `useGameSocket` to dispatch `achievement_unlocked`

**Files:**
- Modify: `packages/frontend/src/hooks/useGameSocket.ts`

- [ ] **Step 1: Find the message dispatch block**

Open `packages/frontend/src/hooks/useGameSocket.ts`. The `ws.onmessage` handler has a chain of `else if (parsed.event === 'X')` branches (price_update, leaderboard_update, trade_executed, etc.).

- [ ] **Step 2: Add `achievement_unlocked` handling**

The hook needs to know the player's `gamePlayerId` and the current `gameId` so it can build the stream. Add a new parameter:

```ts
export function useGameSocket(
  gameId: string,
  symbols: string[],
  myGamePlayerId: string | null,   // NEW
): void {
```

Inside the hook, near the existing `useAchievementToastStore`-adjacent code, import and instantiate the stream:

```ts
import { useAchievementUnlockStream } from './useAchievementUnlockStream';
// inside the hook body:
const { handle: handleAchievementUnlock } = useAchievementUnlockStream(gameId, myGamePlayerId);
const handleAchievementUnlockRef = useRef(handleAchievementUnlock);
handleAchievementUnlockRef.current = handleAchievementUnlock;
```

In `ws.onmessage`, add after the existing branches:

```ts
          } else if (parsed.event === 'achievement_unlocked') {
            handleAchievementUnlockRef.current(parsed.data);
          }
```

- [ ] **Step 3: Update call sites**

Find every `useGameSocket(...)` call (likely in `GameDetailPage.tsx`, possibly one or two others). For each, resolve the current player's `gamePlayerId` from existing state — typically `useAuthStore((s) => s.user?.id)` + the membership info loaded by `useGameAccess` or similar. If the page already loads the membership, pass `membership.gamePlayerId`; otherwise plumb a `useMyGamePlayerId(gameId)` helper.

If a clean source of `gamePlayerId` does NOT exist, add this helper to `packages/frontend/src/hooks/useGameSocket.ts` adjacent to the export:

```ts
import { useGameQuery } from '@/api/games'; // or wherever the game query lives
import { useAuthStore } from '@/stores/authStore';

/** Resolves the current viewer's gamePlayerId for the given game, or null. */
export function useMyGamePlayerId(gameId: string): string | null {
  const userId = useAuthStore((s) => s.user?.id) ?? null;
  const { data: game } = useGameQuery(gameId);
  if (!userId || !game) return null;
  return game.players?.find((p) => p.userId === userId)?.id ?? null;
}
```

Match whatever helper or API the codebase already uses to fetch the per-game player list.

- [ ] **Step 4: Run frontend tests**

Run: `pnpm --filter frontend test`
Expected: PASS. If `useGameSocket.test.tsx` fails because the signature changed, update the test to pass a 3rd arg (`null` for tests that don't care).

- [ ] **Step 5: Run typecheck + lint**

Run: `pnpm --filter frontend typecheck && pnpm --filter frontend lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/hooks/useGameSocket.ts \
        packages/frontend/src/pages/ \
        packages/frontend/tests/
git commit -m "feat(frontend): dispatch achievement_unlocked WS frames to the toast store"
```

---

## Task 18: `<AchievementToast>` — two-beat reveal animation

**Files:**
- Create: `packages/frontend/src/components/achievements/AchievementToast.module.css`
- Create: `packages/frontend/src/components/achievements/AchievementToast.tsx`
- Create: `packages/frontend/tests/components/achievements/AchievementToast.test.tsx`

- [ ] **Step 1: Write the CSS keyframes**

Create `packages/frontend/src/components/achievements/AchievementToast.module.css` with the exact timings from the spec:

```css
/*
 * Two-beat reveal — see docs/superpowers/specs/2026-05-23-achievements-frontend-design.md
 * Every animation uses animation-fill-mode: both so the steady-state is the
 * final keyframe (halo lingers at 0.55, icon settles at scale 1, etc.).
 */

.toast {
  position: relative;
  overflow: hidden;
  border-radius: 6px;
  border: 1px solid var(--hairline-strong);
  background: var(--panel);
  display: grid;
  grid-template-columns: 34px 1fr auto;
  gap: 14px;
  align-items: center;
  padding: 16px 18px;
  width: min(420px, calc(100vw - 32px));
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  animation: t-rise 380ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
.toast::before {
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 3px;
  background: var(--rarity);
  transform-origin: top;
  animation: t-bar 320ms ease-out 60ms both;
}
.toast::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(140% 90% at 50% -20%, var(--rarity-glow-strong, var(--rarity-glow)) 0%, transparent 55%);
  pointer-events: none;
  animation: t-halo 1400ms cubic-bezier(0.16, 1, 0.3, 1) 120ms both;
}

.icon {
  position: relative;
  width: 34px; height: 34px;
  display: flex; align-items: center; justify-content: center;
  color: var(--rarity);
  z-index: 1;
}
.icon::after {
  content: '';
  position: absolute;
  inset: -6px;
  border-radius: 50%;
  background: radial-gradient(circle, var(--rarity-glow-strong, var(--rarity-glow)) 0%, transparent 70%);
  animation: t-flare 700ms cubic-bezier(0.16, 1, 0.3, 1) 140ms both;
  z-index: 0;
}
.icon svg {
  position: relative; z-index: 1;
  animation: t-icon 520ms cubic-bezier(0.34, 1.56, 0.64, 1) 120ms both;
}

.body { min-width: 0; position: relative; z-index: 1; }
.eyebrow, .name, .desc {
  animation: t-text 460ms cubic-bezier(0.22, 1, 0.36, 1) 220ms both;
}

.ring {
  position: absolute;
  inset: -2px;
  border-radius: 7px;
  border: 1.5px solid var(--rarity);
  pointer-events: none;
  animation: t-ring 900ms cubic-bezier(0.22, 1, 0.36, 1) 180ms both;
}

@keyframes t-rise   { 0% { opacity: 0; transform: translateY(-14px) scale(0.985); } 100% { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes t-bar    { 0% { transform: scaleY(0); opacity: 0; } 100% { transform: scaleY(1); opacity: 1; } }
@keyframes t-halo   { 0% { opacity: 0; } 35% { opacity: 1; } 100% { opacity: 0.55; } }
@keyframes t-flare  { 0% { opacity: 0; transform: scale(0.4); } 40% { opacity: 1; transform: scale(1.15); } 100% { opacity: 0; transform: scale(1.8); } }
@keyframes t-icon   { 0% { opacity: 0; transform: scale(0.55) rotate(-10deg); } 55% { opacity: 1; transform: scale(1.18) rotate(3deg); } 100% { opacity: 1; transform: scale(1) rotate(0); } }
@keyframes t-ring   { 0% { opacity: 0; transform: scale(0.985); } 25% { opacity: 1; } 100% { opacity: 0; transform: scale(1.06); } }
@keyframes t-text   { 0% { opacity: 0; transform: translateX(-4px); } 100% { opacity: 1; transform: translateX(0); } }

/* Strengthen the halo on the toast specifically — the at-rest card glow
   uses lower opacity tokens; the toast benefits from extra punch. */
.toast {
  --rarity-glow-strong: color-mix(in srgb, var(--rarity) 26%, transparent);
}

.toastExit { animation: t-exit 220ms ease-in both; }
@keyframes t-exit { 0% { opacity: 1; transform: translateY(0); } 100% { opacity: 0; transform: translateY(-12px); } }
```

- [ ] **Step 2: Write the failing toast test**

Create `packages/frontend/tests/components/achievements/AchievementToast.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AchievementToast } from '@/components/achievements/AchievementToast';
import { useAchievementToastStore } from '@/stores/achievementToastStore';
import type { WsAchievementUnlockedEvent } from '@markettrader/shared';

vi.mock('@/api/achievements', () => ({
  ackAchievementUnlock: vi.fn().mockResolvedValue(undefined),
}));

const unlock: WsAchievementUnlockedEvent['data'] = {
  gamePlayerId: 'gp1',
  achievementKey: 'diamond-hands',
  name: 'Diamond Hands',
  description: 'Hold a single position from start to finish.',
  rarity: 'legendary',
  icon: 'gem',
  unlockedAt: '2026-05-23T12:00:00.000Z',
};

describe('AchievementToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAchievementToastStore.setState({ current: null, queue: [] });
    localStorage.clear();
  });
  afterEach(() => vi.useRealTimers());

  it('renders the rarity eyebrow + name', () => {
    render(<AchievementToast gameId="g1" toast={{ id: 't1', unlock, enqueuedAt: 0 }} />);
    expect(screen.getByText(/legendary · unlocked/i)).toBeInTheDocument();
    expect(screen.getByText('Diamond Hands')).toBeInTheDocument();
  });

  it('shows relative-time suffix when replayed=true', () => {
    const replayed = { ...unlock, replayed: true, unlockedAt: new Date(Date.now() - 7_200_000).toISOString() };
    render(<AchievementToast gameId="g1" toast={{ id: 't1', unlock: replayed, enqueuedAt: 0 }} />);
    expect(screen.getByText(/2h ago/i)).toBeInTheDocument();
  });

  it('dismisses on × click and calls dismiss(id) on the store', () => {
    const dismiss = vi.fn();
    useAchievementToastStore.setState({ current: { id: 't1', unlock, enqueuedAt: 0 }, queue: [] });
    useAchievementToastStore.setState((s) => ({ ...s, dismiss }) as any);
    render(<AchievementToast gameId="g1" toast={{ id: 't1', unlock, enqueuedAt: 0 }} />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    // Wait through the exit animation tick:
    vi.advanceTimersByTime(300);
    expect(dismiss).toHaveBeenCalledWith('t1');
  });

  it('auto-dismisses after the 6s display window', () => {
    const dismiss = vi.fn();
    useAchievementToastStore.setState({ current: { id: 't1', unlock, enqueuedAt: 0 }, queue: [] });
    useAchievementToastStore.setState((s) => ({ ...s, dismiss }) as any);
    render(<AchievementToast gameId="g1" toast={{ id: 't1', unlock, enqueuedAt: 0 }} />);
    // 6s display + ~220ms exit
    vi.advanceTimersByTime(6300);
    expect(dismiss).toHaveBeenCalledWith('t1');
  });
});
```

- [ ] **Step 3: Run, observe failure**

Run: `pnpm --filter frontend test -- AchievementToast`
Expected: FAIL — component not found.

- [ ] **Step 4: Implement the toast component**

Create `packages/frontend/src/components/achievements/AchievementToast.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getAchievementIcon } from './icon';
import { rarityClass, rarityLabel } from './rarity';
import { useAchievementToastStore, type AchievementToast as ToastEntry } from '@/stores/achievementToastStore';
import { advanceSeenMarker } from '@/lib/achievementSeenMarker';
import { ackAchievementUnlock } from '@/api/achievements';
import styles from './AchievementToast.module.css';

const DISPLAY_MS = 6_000;
const EXIT_MS = 220;

interface AchievementToastProps {
  gameId: string;
  toast: ToastEntry;
}

function relativeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/**
 * Single in-flight unlock toast. Owns its own auto-dismiss timer and exit
 * animation. On dismissal: marks the localStorage seen marker, fires the
 * server ack (best-effort), then asks the store to advance.
 */
export function AchievementToast({ gameId, toast }: AchievementToastProps) {
  const dismiss = useAchievementToastStore((s) => s.dismiss);
  const [exiting, setExiting] = useState(false);

  const finish = () => {
    if (exiting) return;
    setExiting(true);
    advanceSeenMarker(gameId, toast.unlock.gamePlayerId, toast.unlock.unlockedAt);
    ackAchievementUnlock(gameId, toast.unlock.gamePlayerId, toast.unlock.unlockedAt).catch(() => {
      // Non-fatal — replay on next connect handles it.
    });
    window.setTimeout(() => dismiss(toast.id), EXIT_MS);
  };

  useEffect(() => {
    const timer = window.setTimeout(finish, DISPLAY_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast.id]);

  const Icon = getAchievementIcon(toast.unlock.icon);
  const eyebrow = toast.unlock.replayed
    ? `${rarityLabel(toast.unlock.rarity).toUpperCase()} · UNLOCKED · ${relativeAgo(toast.unlock.unlockedAt).toUpperCase()}`
    : `${rarityLabel(toast.unlock.rarity).toUpperCase()} · UNLOCKED`;

  return (
    <div className={cn(styles.toast, exiting && styles.toastExit, rarityClass(toast.unlock.rarity))} role="status">
      <span className={styles.icon}>
        <Icon width={26} height={26} strokeWidth={1.6} />
      </span>
      <div className={styles.body}>
        <div className={cn(styles.eyebrow, 'font-mono text-[9px] tracking-[0.22em]')} style={{ color: 'var(--rarity)' }}>
          {eyebrow}
        </div>
        <div className={cn(styles.name, 'text-[15px] font-semibold text-text-strong leading-tight mt-0.5')}>
          {toast.unlock.name}
        </div>
        <div className={cn(styles.desc, 'text-[11px] text-muted leading-snug mt-0.5')}>
          {toast.unlock.description}
        </div>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={finish}
        className="self-start text-muted hover:text-text p-1"
      >
        <X size={14} />
      </button>
      <span className={styles.ring} aria-hidden />
    </div>
  );
}
```

- [ ] **Step 5: Run tests, expect green**

Run: `pnpm --filter frontend test -- AchievementToast`
Expected: PASS for all four cases.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/components/achievements/AchievementToast.tsx \
        packages/frontend/src/components/achievements/AchievementToast.module.css \
        packages/frontend/tests/components/achievements/AchievementToast.test.tsx
git commit -m "feat(frontend): <AchievementToast> with two-beat reveal + ack on dismiss"
```

---

## Task 19: `<AchievementToastHost>` + mount in `AppShell`

**Files:**
- Create: `packages/frontend/src/components/achievements/AchievementToastHost.tsx`
- Modify: `packages/frontend/src/components/shell/AppShell.tsx`

- [ ] **Step 1: Create the host**

Create `packages/frontend/src/components/achievements/AchievementToastHost.tsx`:

```tsx
import { useParams } from 'react-router-dom';
import { AchievementToast } from './AchievementToast';
import { useAchievementToastStore } from '@/stores/achievementToastStore';

/**
 * Single instance, mounted in AppShell. Renders the currently-displayed
 * toast in a top-center fixed slot below the ticker tape. The store enforces
 * strict serial display — only one toast is rendered at a time.
 */
export function AchievementToastHost() {
  const current = useAchievementToastStore((s) => s.current);
  const { gameId } = useParams<{ gameId?: string }>();

  if (!current || !gameId) return null;

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-50"
      style={{ top: 76 }}
      aria-live="polite"
      aria-atomic="true"
    >
      <AchievementToast gameId={gameId} toast={current} />
    </div>
  );
}
```

If the routed pages don't expose `gameId` via `useParams` at the AppShell level (because `AppShell` wraps both game-scoped and global routes), instead read it from a Zustand store (`liveStore` already tracks the active game) or pass it as a prop from the relevant route layout. Use whichever matches the existing pattern.

- [ ] **Step 2: Mount in `AppShell`**

Open `packages/frontend/src/components/shell/AppShell.tsx`. After the existing `<TickerTape />` (or wherever the header chain ends), and **before** `{children}` / `<Outlet />`, add:

```tsx
import { AchievementToastHost } from '@/components/achievements/AchievementToastHost';
// …
<AchievementToastHost />
```

- [ ] **Step 3: Typecheck + run a smoke test by importing**

Run: `pnpm --filter frontend typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/components/achievements/AchievementToastHost.tsx \
        packages/frontend/src/components/shell/AppShell.tsx
git commit -m "feat(frontend): mount <AchievementToastHost> in app shell"
```

---

## Task 20: `<AchievementGrid>` — cards + filter chips + URL sync

**Files:**
- Create: `packages/frontend/src/components/achievements/AchievementGrid.tsx`

- [ ] **Step 1: Implement the grid**

Create `packages/frontend/src/components/achievements/AchievementGrid.tsx`:

```tsx
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { AchievementCard } from './AchievementCard';
import { ALL_RARITIES, compareRarity, rarityLabel } from './rarity';
import type {
  AchievementDefinitionDTO,
  AchievementProgressDTO,
  AchievementRarity,
} from '@markettrader/shared';

export interface AchievementGridProps {
  definitions: AchievementDefinitionDTO[];
  /** Progress entries for the viewer (one optional row per definition). */
  progress: AchievementProgressDTO[];
  className?: string;
}

type StateFilter = 'all' | 'unlocked' | 'locked';

function parseRarityFilter(raw: string | null): Set<AchievementRarity> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .filter((v): v is AchievementRarity =>
        (['common', 'uncommon', 'rare', 'epic', 'legendary'] as const).includes(v as AchievementRarity),
      ),
  );
}

export function AchievementGrid({ definitions, progress, className }: AchievementGridProps) {
  const [params, setParams] = useSearchParams();
  const rarityFilter = parseRarityFilter(params.get('rarity'));
  const stateFilter = (params.get('state') as StateFilter | null) ?? 'all';

  const progressByKey = useMemo(() => {
    const m = new Map<string, AchievementProgressDTO>();
    for (const p of progress) m.set(p.achievementKey, p);
    return m;
  }, [progress]);

  const filtered = useMemo(() => {
    return definitions
      .filter((d) => {
        if (rarityFilter.size > 0 && !rarityFilter.has(d.rarity)) return false;
        const p = progressByKey.get(d.key);
        const unlocked = Boolean(p?.unlockedAt);
        if (stateFilter === 'unlocked' && !unlocked) return false;
        if (stateFilter === 'locked' && unlocked) return false;
        return true;
      })
      .sort((a, b) => {
        const ua = Boolean(progressByKey.get(a.key)?.unlockedAt);
        const ub = Boolean(progressByKey.get(b.key)?.unlockedAt);
        const r = compareRarity(a.rarity, b.rarity);
        if (r !== 0) return r;
        if (ua !== ub) return ua ? -1 : 1;
        return a.key.localeCompare(b.key);
      });
  }, [definitions, progressByKey, rarityFilter, stateFilter]);

  const toggleRarity = (r: AchievementRarity) => {
    const next = new Set(rarityFilter);
    if (next.has(r)) next.delete(r); else next.add(r);
    const newParams = new URLSearchParams(params);
    if (next.size === 0) newParams.delete('rarity');
    else newParams.set('rarity', [...next].join(','));
    setParams(newParams, { replace: true });
  };
  const setState = (s: StateFilter) => {
    const newParams = new URLSearchParams(params);
    if (s === 'all') newParams.delete('state');
    else newParams.set('state', s);
    setParams(newParams, { replace: true });
  };

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip active={rarityFilter.size === 0} onClick={() => setParams((p) => { const np = new URLSearchParams(p); np.delete('rarity'); return np; }, { replace: true })}>
          All
        </Chip>
        {ALL_RARITIES.map((r) => (
          <Chip key={r} active={rarityFilter.has(r)} rarity={r} onClick={() => toggleRarity(r)}>
            {rarityLabel(r)}
          </Chip>
        ))}
        <div className="ml-auto flex gap-1.5">
          <Chip active={stateFilter === 'unlocked'} onClick={() => setState(stateFilter === 'unlocked' ? 'all' : 'unlocked')}>
            Unlocked
          </Chip>
          <Chip active={stateFilter === 'locked'} onClick={() => setState(stateFilter === 'locked' ? 'all' : 'locked')}>
            Locked
          </Chip>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {filtered.map((d) => {
          const p = progressByKey.get(d.key) ?? null;
          const featured = d.rarity === 'legendary' && Boolean(p?.unlockedAt);
          return (
            <AchievementCard
              key={d.key}
              definition={d}
              progress={p}
              className={featured ? 'md:col-span-2' : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}

function Chip({
  children,
  active,
  rarity,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  rarity?: AchievementRarity;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'font-mono text-[10px] uppercase tracking-[0.12em] px-2 py-1 rounded-sm border',
        active
          ? 'text-text-strong'
          : 'text-muted hover:text-text border-hairline-strong',
        rarity && active && `rar-${rarity}`,
      )}
      style={
        rarity && active
          ? { background: 'var(--rarity-glow)', borderColor: 'color-mix(in srgb, var(--rarity) 35%, transparent)', color: 'var(--rarity)' }
          : active
            ? { background: 'var(--accent-bg)', borderColor: 'rgba(103,232,249,0.35)' }
            : undefined
      }
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter frontend typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/achievements/AchievementGrid.tsx
git commit -m "feat(frontend): <AchievementGrid> with rarity + state filters and URL sync"
```

---

## Task 21: `<AchievementRoster>` — per-player rollup

**Files:**
- Create: `packages/frontend/src/components/achievements/AchievementRoster.tsx`
- Create: `packages/frontend/tests/components/achievements/AchievementRoster.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/tests/components/achievements/AchievementRoster.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AchievementRoster } from '@/components/achievements/AchievementRoster';
import type { AchievementDefinitionDTO, AchievementProgressDTO } from '@markettrader/shared';

const defs: AchievementDefinitionDTO[] = [
  { key: 'a', name: 'A', description: '', rarity: 'common',    icon: 'x', target: 1, enabled: true },
  { key: 'b', name: 'B', description: '', rarity: 'legendary', icon: 'x', target: 1, enabled: true },
];

function p(key: string, gamePlayerId: string, unlocked: boolean): AchievementProgressDTO {
  return { achievementKey: key, gamePlayerId, progress: unlocked ? 1 : 0, target: 1, unlockedAt: unlocked ? '2026-05-23T12:00:00.000Z' : null };
}

describe('AchievementRoster', () => {
  it('counts unlocks per player and breaks out legendary count', () => {
    render(
      <MemoryRouter>
        <AchievementRoster
          gameId="g1"
          myGamePlayerId="gp1"
          definitions={defs}
          progressByPlayer={{
            gp1: [p('a', 'gp1', true), p('b', 'gp1', true)],
            gp2: [p('a', 'gp2', true)],
          }}
          usernames={{ gp1: 'alice', gp2: 'bob' }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.getByText(/2 unlocked · 1 leg/)).toBeInTheDocument();
    expect(screen.getByText(/1 unlocked · 0 leg/)).toBeInTheDocument();
  });

  it('puts the current player first and marks them with YOU', () => {
    render(
      <MemoryRouter>
        <AchievementRoster
          gameId="g1"
          myGamePlayerId="gp2"
          definitions={defs}
          progressByPlayer={{
            gp1: [p('a', 'gp1', true), p('b', 'gp1', true)],
            gp2: [p('a', 'gp2', true)],
          }}
          usernames={{ gp1: 'alice', gp2: 'bob' }}
        />
      </MemoryRouter>,
    );
    const rows = screen.getAllByRole('link');
    expect(rows[0]).toHaveTextContent('bob');
    expect(screen.getByText('YOU')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, observe failure**

Run: `pnpm --filter frontend test -- AchievementRoster`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/frontend/src/components/achievements/AchievementRoster.tsx`:

```tsx
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import type {
  AchievementDefinitionDTO,
  AchievementProgressDTO,
} from '@markettrader/shared';

export interface AchievementRosterProps {
  gameId: string;
  myGamePlayerId: string | null;
  definitions: AchievementDefinitionDTO[];
  progressByPlayer: Record<string, AchievementProgressDTO[]>;
  usernames: Record<string, string>;
  className?: string;
}

export function AchievementRoster({
  gameId,
  myGamePlayerId,
  definitions,
  progressByPlayer,
  usernames,
  className,
}: AchievementRosterProps) {
  const rarityByKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of definitions) m.set(d.key, d.rarity);
    return m;
  }, [definitions]);

  const rows = useMemo(() => {
    const out = Object.entries(progressByPlayer).map(([gpid, items]) => {
      const unlockedItems = items.filter((p) => p.unlockedAt);
      const legendaryCount = unlockedItems.filter((p) => rarityByKey.get(p.achievementKey) === 'legendary').length;
      return {
        gamePlayerId: gpid,
        username: usernames[gpid] ?? gpid.slice(0, 8),
        isMe: gpid === myGamePlayerId,
        unlockedCount: unlockedItems.length,
        legendaryCount,
      };
    });
    out.sort((a, b) => {
      if (a.isMe !== b.isMe) return a.isMe ? -1 : 1;
      return b.unlockedCount - a.unlockedCount;
    });
    return out;
  }, [progressByPlayer, rarityByKey, usernames, myGamePlayerId]);

  return (
    <div className={cn('border-t border-hairline pt-3', className)}>
      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-muted mb-2">
        Other players
      </div>
      <div className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <Link
            key={r.gamePlayerId}
            to={r.isMe ? `/games/${gameId}/achievements` : `/games/${gameId}/achievements?player=${r.gamePlayerId}`}
            className="flex items-center justify-between text-[11px] hover:bg-accent-bg rounded-sm px-1 py-0.5"
          >
            <span className="text-text">
              {r.username}
              {r.isMe && (
                <span className="ml-1.5 font-mono text-[9px] tracking-[0.12em] text-accent">YOU</span>
              )}
            </span>
            <span className="font-mono text-[10px] text-muted tabular-nums">
              {r.unlockedCount} unlocked · {r.legendaryCount} leg.
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests, expect green**

Run: `pnpm --filter frontend test -- AchievementRoster`
Expected: PASS for both cases.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/achievements/AchievementRoster.tsx \
        packages/frontend/tests/components/achievements/AchievementRoster.test.tsx
git commit -m "feat(frontend): <AchievementRoster> per-player rollup with YOU pin + drilldown"
```

---

## Task 22: `<AchievementsPage>` + route + header link

**Files:**
- Create: `packages/frontend/src/pages/AchievementsPage.tsx`
- Create: `packages/frontend/tests/pages/AchievementsPage.test.tsx`
- Modify: `packages/frontend/src/App.tsx`
- Modify: `packages/frontend/src/components/AppHeader.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/tests/pages/AchievementsPage.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { AchievementsPage } from '@/pages/AchievementsPage';

vi.mock('@/api/achievements', () => ({
  getGameAchievements: vi.fn().mockResolvedValue({
    definitions: [
      { key: 'a', name: 'A', description: '', rarity: 'common', icon: 'x', target: 1, enabled: true },
      { key: 'b', name: 'B', description: '', rarity: 'legendary', icon: 'x', target: 1, enabled: true },
    ],
    progress: {
      gp1: [{ achievementKey: 'a', gamePlayerId: 'gp1', progress: 1, target: 1, unlockedAt: '2026-05-23T12:00:00.000Z' }],
    },
  }),
  achievementKeys: { game: (g: string) => ['achievements', g, 'all'] },
}));

vi.mock('@/api/games', () => ({
  getGame: vi.fn().mockResolvedValue({
    id: 'g1',
    players: [{ id: 'gp1', userId: 'u1', username: 'alice' }],
  }),
  gameKeys: { single: (g: string) => ['games', g] },
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/games/g1/achievements']}>
        <Routes>
          <Route path="/games/:gameId/achievements" element={<AchievementsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AchievementsPage', () => {
  it('renders the grid with definitions after load', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('A')).toBeInTheDocument());
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('shows the unlock count in the header', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/1 \/ 2 unlocked/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run, observe failure**

Run: `pnpm --filter frontend test -- AchievementsPage`
Expected: FAIL — page not found.

- [ ] **Step 3: Implement the page**

Create `packages/frontend/src/pages/AchievementsPage.tsx`:

```tsx
import { useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Panel, PanelHeader, PanelBody } from '@/components/panel';
import { AchievementGrid } from '@/components/achievements/AchievementGrid';
import { AchievementRoster } from '@/components/achievements/AchievementRoster';
import { useAchievements } from '@/hooks/useAchievements';
import { useMyGamePlayerId } from '@/hooks/useGameSocket';
// If the codebase uses a different gateway for game data, swap in here:
import { getGame, gameKeys } from '@/api/games';

export function AchievementsPage() {
  const { gameId = '' } = useParams<{ gameId: string }>();
  const [params] = useSearchParams();
  const drilldownPlayerId = params.get('player') ?? null;
  const myGamePlayerId = useMyGamePlayerId(gameId);

  const { data: game } = useQuery({
    queryKey: gameKeys.single(gameId),
    queryFn: () => getGame(gameId),
    enabled: Boolean(gameId),
  });

  const { data: all } = useAchievements(gameId);
  const { data: scoped } = useAchievements(gameId, drilldownPlayerId ?? '');
  const viewProgress = drilldownPlayerId
    ? scoped?.progress ?? []
    : myGamePlayerId
      ? all?.progress?.[myGamePlayerId] ?? []
      : [];
  const definitions = all?.definitions ?? scoped?.definitions ?? [];

  const usernames = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of game?.players ?? []) m[p.id] = p.username;
    return m;
  }, [game]);

  const unlockedCount = viewProgress.filter((p) => p.unlockedAt).length;
  const totalCount = definitions.length;

  return (
    <Panel className="m-4">
      <PanelHeader>
        <div className="flex items-center justify-between w-full">
          <div>
            <div className="text-[12px] font-semibold text-text-strong">Achievements</div>
            {drilldownPlayerId && (
              <div className="text-[10px] text-muted mt-0.5">
                Viewing {usernames[drilldownPlayerId] ?? 'player'}'s progress ·{' '}
                <Link to={`/games/${gameId}/achievements`} className="text-accent">
                  ← back to mine
                </Link>
              </div>
            )}
          </div>
          <div className="font-mono text-[10px] text-muted tracking-[0.06em]">
            {unlockedCount} / {totalCount} unlocked
          </div>
        </div>
      </PanelHeader>
      <PanelBody className="flex flex-col gap-4">
        <AchievementGrid definitions={definitions} progress={viewProgress} />
        {!drilldownPlayerId && all && (
          <AchievementRoster
            gameId={gameId}
            myGamePlayerId={myGamePlayerId}
            definitions={definitions}
            progressByPlayer={all.progress}
            usernames={usernames}
          />
        )}
      </PanelBody>
    </Panel>
  );
}
```

- [ ] **Step 4: Wire the route**

Open `packages/frontend/src/App.tsx`. Find the `<Routes>` block where other game-scoped routes live. Add:

```tsx
import { AchievementsPage } from '@/pages/AchievementsPage';
// inside <Routes>:
<Route path="/games/:gameId/achievements" element={<ProtectedRoute><AchievementsPage /></ProtectedRoute>} />
```

(Match the existing route-wrapping conventions — `<ProtectedRoute>` is likely already used by `GameDetailPage`.)

- [ ] **Step 5: Add the header link**

Open `packages/frontend/src/components/AppHeader.tsx`. The header already renders game-scoped links (Portfolio etc.) on game pages. Add a sibling `Link` element:

```tsx
<Link to={`/games/${gameId}/achievements`} className={cn('nav-link', isActive('achievements') && 'active')}>
  Achievements
</Link>
```

Match the helper functions and styling the file already uses; the snippet above is illustrative — read the file and conform.

- [ ] **Step 6: Run tests, expect green**

Run: `pnpm --filter frontend test -- AchievementsPage`
Expected: PASS.

- [ ] **Step 7: Run the full frontend test + typecheck + lint**

Run: `pnpm --filter frontend test && pnpm --filter frontend typecheck && pnpm --filter frontend lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/frontend/src/pages/AchievementsPage.tsx \
        packages/frontend/tests/pages/AchievementsPage.test.tsx \
        packages/frontend/src/App.tsx \
        packages/frontend/src/components/AppHeader.tsx
git commit -m "feat(frontend): /games/:id/achievements page + route + header link"
```

---

## Task 23: Invalidate the achievements query on `achievement_unlocked`

**Files:**
- Modify: `packages/frontend/src/hooks/useGameSocket.ts`

- [ ] **Step 1: Locate the branch added in Task 17**

Open `packages/frontend/src/hooks/useGameSocket.ts`. Find the `} else if (parsed.event === 'achievement_unlocked') {` block.

- [ ] **Step 2: Add a React Query invalidation alongside the toast dispatch**

Inside the same branch, after the stream handler call, add:

```ts
            qcRef.current.invalidateQueries({ queryKey: ['achievements', gameId] });
```

`qcRef` already exists in the file (it's stashed for the leaderboard refresh). Reuse it.

- [ ] **Step 3: Run frontend tests + typecheck**

Run: `pnpm --filter frontend test && pnpm --filter frontend typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/hooks/useGameSocket.ts
git commit -m "feat(frontend): invalidate achievements query on unlock so panel refreshes"
```

---

## Task 24: Playwright e2e — own-unlock end-to-end

**Files:**
- Create: `packages/frontend/e2e/achievements.spec.ts`

- [ ] **Step 1: Write the e2e test**

Create `packages/frontend/e2e/achievements.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { createGameWithTwoPlayers, executeTrade, login } from './helpers';

test('first-trade unlock shows a toast for the trading player only', async ({ browser }) => {
  // Two contexts, one for alice (who will trade), one for bob (the observer).
  const { aliceCtx, bobCtx, gameId } = await createGameWithTwoPlayers(browser);

  await login(aliceCtx, 'alice');
  await login(bobCtx, 'bob');

  const alicePage = await aliceCtx.newPage();
  const bobPage = await bobCtx.newPage();
  await alicePage.goto(`/games/${gameId}`);
  await bobPage.goto(`/games/${gameId}`);
  // Wait for WS to be live.
  await Promise.all([
    alicePage.waitForSelector('[data-testid="game-shell"]'),
    bobPage.waitForSelector('[data-testid="game-shell"]'),
  ]);

  await executeTrade(alicePage, { symbol: 'AAPL', direction: 'buy', quantity: 1 });

  // Alice sees the toast (legendary or whatever first-trade's rarity is).
  await expect(alicePage.getByText('First Trade')).toBeVisible({ timeout: 3_000 });
  await expect(alicePage.getByText(/common · unlocked/i)).toBeVisible();

  // Bob does NOT see a toast.
  await expect(bobPage.getByText('First Trade')).not.toBeVisible();
});
```

The helpers (`createGameWithTwoPlayers`, `executeTrade`, `login`) almost certainly exist for the existing e2e suite — reuse them. If they don't, copy the pattern from another e2e spec in the same directory; do NOT invent test infra from scratch in this task.

- [ ] **Step 2: Run e2e**

Run: `pnpm --filter frontend e2e -- achievements.spec`
Expected: PASS. If helpers don't exist as named, either extend them or use the same direct API calls other specs use.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/e2e/achievements.spec.ts
git commit -m "test(frontend): e2e — own-unlock toast appears for trader only"
```

---

## Task 25: Manual verification + final commit

- [ ] **Step 1: Run all checks**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: every package passes.

- [ ] **Step 2: Manual smoke**

```bash
pnpm dev
```

In the browser:
- Create a game with two test users.
- As player A, place a trade — confirm:
  - Two-beat reveal toast appears top-center with amber/green/etc. (whatever rarity `first-trade` has)
  - Toast auto-dismisses after ~6s
  - Network tab shows `POST /api/games/:id/players/:id/achievements/ack` fire on dismiss
  - localStorage has `last_seen_unlock_at:…` key advanced
  - Navigating to `/games/:id/achievements` shows the unlocked card with halo + roster lists both players
- As player B (in a second browser): confirm NO toast for player A's unlock. The achievements panel shows player A's unlock count in the roster after refresh.
- Open devtools, enable `prefers-reduced-motion`, trigger another unlock: toast appears instantly at final state.
- Refresh the trader's tab mid-toast: the connect-time replay either replays (if not yet acked) or stays silent (if already acked). Confirm no double-toast either way.

- [ ] **Step 3: Final summary commit (if any cleanup)**

If anything was caught and fixed, commit it now with `chore(achievements): post-implementation fixes`.

---

## Self-review notes

This plan covers:

- ✅ Spec § "Rarity tokens" → Task 9
- ✅ Spec § "Backend changes required" (defineAchievement + DTOs + WS event) → Tasks 1–4
- ✅ Spec § "Showing each unlock exactly once" → Tasks 5–8, 14–16, 18
- ✅ Spec § "Frontend file layout" → covered across Tasks 10–22
- ✅ Spec § "The achievement card (at rest)" → Task 12
- ✅ Spec § "The unlock toast — two-beat reveal" with exact timings → Task 18
- ✅ Spec § "The achievements page" with filters/sort/roster/responsive → Tasks 20–22
- ✅ Spec § "React Query + data flow" → Tasks 13, 23
- ✅ Spec § "Testing" (Vitest + Playwright) → tests in each task plus Task 24

Type consistency: `AchievementRarity` defined in Task 1, re-exported in Task 2, used in Tasks 10/12/13/15/16/18/20/21. `AchievementToast` interface defined in Task 15, consumed in Tasks 18/19. `getAchievementIcon` defined in Task 11, used in Tasks 12/18. `useMyGamePlayerId` added in Task 17, consumed in Task 22.

No placeholders, no "TODO", no "similar to Task N". Every code step includes the actual code.
