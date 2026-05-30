# Locked Achievement Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make locked (unearned) achievements visible to players — name, description, and the viewer's own progress — while adding a dormant `secret` flag so individual achievements can be kept hidden until earned.

**Architecture:** The achievements page moves from the game-wide endpoint to the existing per-player endpoint (`GET /games/:id/players/:gpid/achievements`), which now returns all enabled non-secret definitions (locked + unlocked) plus the requesting owner's own progress rows. The game-wide endpoint (which feeds the activity feed) is unchanged in logic. A `secret` flag on definitions hides individual achievements from a player's catalog until that player unlocks them; nothing is flagged secret initially.

**Tech Stack:** TypeScript (strict), Fastify v5, Drizzle ORM, Vitest (server + frontend), React 19, React Query, Testing Library.

**Spec:** `docs/superpowers/specs/2026-05-30-locked-achievement-visibility-design.md`

**Conventions:** pnpm workspace. Run server tests with `pnpm --filter server test`, frontend with `pnpm --filter frontend test`. Typecheck/lint at root: `pnpm typecheck`, `pnpm lint`. `@markettrader/shared` is consumed via its built `dist`, so after editing shared types run `pnpm --filter shared build` before typechecking downstream packages.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/shared/src/types/achievement.ts` | `secret` field on the DTO | Modify |
| `packages/server/src/achievements/define.ts` | `secret?` field on the definition interface | Modify |
| `packages/server/src/services/achievement.ts` | DTO mapping; `getProgressForPlayer` gains `includeLocked` + secret filtering | Modify |
| `packages/server/src/routes/achievements.ts` | Compute ownership, pass `includeLocked` | Modify |
| `packages/server/tests/services/achievement.test.ts` | Service-level tests for secret + `includeLocked` | Create |
| `packages/server/tests/routes/achievements.test.ts` | Route-level owner/non-owner tests | Modify |
| `packages/frontend/src/api/achievements.ts` | Fix per-player response type + JSDoc | Modify |
| `packages/frontend/src/pages/AchievementsPage.tsx` | Use per-player endpoint; render all defs | Modify |
| `packages/frontend/src/components/achievements/AchievementGrid.tsx` | Reword locked tile → "secret" | Modify |
| `packages/frontend/tests/pages/AchievementsPage.test.tsx` | Locked-card + secret-tile rendering | Modify |

---

## Task 1: Add the `secret` field (shared DTO → definition → DTO mapping)

**Files:**
- Modify: `packages/shared/src/types/achievement.ts`
- Modify: `packages/server/src/achievements/define.ts:46-63`
- Modify: `packages/server/src/services/achievement.ts:181-198`
- Test: `packages/server/tests/routes/achievements.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/server/tests/routes/achievements.test.ts`, inside the existing
`describe('GET /games/:id/achievements', ...)`, add:

```ts
it('exposes a secret flag (false by default) on every definition', async () => {
  const { token } = await registerUser(app, `u-${Math.random().toString(36).slice(2)}`);
  const game = await createGame(app, token);
  await app.inject({
    method: 'POST',
    url: `/games/${game.id}/trades`,
    headers: { Authorization: `Bearer ${token}` },
    payload: { symbol: 'AAPL', direction: 'buy', quantity: 1 },
  });
  const res = await app.inject({
    method: 'GET',
    url: `/games/${game.id}/achievements`,
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = res.json<{ definitions: Array<{ key: string; secret: boolean }> }>();
  expect(body.definitions.length).toBeGreaterThan(0);
  for (const d of body.definitions) expect(d.secret).toBe(false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter server test -- achievements.test`
Expected: FAIL — `expected undefined to be false` (the field doesn't exist yet).

- [ ] **Step 3: Add `secret` to the shared DTO**

In `packages/shared/src/types/achievement.ts`, add to `AchievementDefinitionDTO`
(after the `enabled` field):

```ts
  /** When true, hidden from a player's catalog until that player unlocks it. */
  secret: boolean;
```

- [ ] **Step 4: Add `secret?` to the server definition interface**

In `packages/server/src/achievements/define.ts`, inside
`interface AchievementDefinition`, add after the `target` field:

```ts
  /** Optional. When true, hidden from the catalog until the player unlocks it. Defaults to false. */
  secret?: boolean;
```

(No change needed to `AnyAchievementDefinition` — it derives from `AchievementDefinition`.)

- [ ] **Step 5: Map `secret` in `buildDefinitionDTOs`**

In `packages/server/src/services/achievement.ts`, in `buildDefinitionDTOs`, add
`secret` to the mapped object (after `target: d.target,`):

```ts
      secret: d.secret ?? false,
```

- [ ] **Step 6: Rebuild shared so downstream types see the field**

Run: `pnpm --filter shared build`
Expected: exits 0.

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter server test -- achievements.test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/types/achievement.ts packages/server/src/achievements/define.ts packages/server/src/services/achievement.ts packages/server/tests/routes/achievements.test.ts
git commit -m "feat(achievements): add secret flag to definition + DTO"
```

---

## Task 2: `getProgressForPlayer` — `includeLocked` + secret filtering

**Files:**
- Modify: `packages/server/src/services/achievement.ts:86-139`
- Test: `packages/server/tests/services/achievement.test.ts` (create)

The new contract:
- definitions = enabled defs where `!secret || this player unlocked it`.
- progress rows = this player's rows for visible defs; **unlocked rows always; in-progress (locked) rows only when `includeLocked` is true**.

- [ ] **Step 1: Write the failing test**

Create `packages/server/tests/services/achievement.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../helpers/app.js';
import * as schema from '../../src/db/schema.sqlite.js';
import { AchievementEngine } from '../../src/achievements/engine.js';
import { EventBus } from '../../src/events/bus.js';
import { defineAchievement } from '../../src/achievements/define.js';
import { GameClientRegistry } from '../../src/ws/registry.js';
import { SystemSettingsService } from '../../src/services/system-settings.js';
import { getProgressForPlayer } from '../../src/services/achievement.js';
import type { Db } from '../../src/db/index.js';

async function seedGame(db: Db) {
  const [user] = await db
    .insert(schema.users)
    .values({ username: `u-${Math.random().toString(36).slice(2)}`, passwordHash: 'x' })
    .returning();
  const [game] = await db
    .insert(schema.games)
    .values({
      name: 'g',
      startDate: '2020-01-01T00:00:00.000Z',
      endDate: '2099-01-01T00:00:00.000Z',
      startingBalance: 10000,
      createdBy: user!.id,
      achievementsEnabled: true,
    })
    .returning();
  const [gp] = await db
    .insert(schema.gamePlayers)
    .values({ gameId: game!.id, userId: user!.id, cashBalance: 10000 })
    .returning();
  return { gameId: game!.id, gamePlayerId: gp!.id };
}

function makeEngine(db: Db, defs: ReturnType<typeof defineAchievement>[]) {
  const bus = new EventBus();
  const settings = new SystemSettingsService(db);
  const registry = new GameClientRegistry();
  const engine = new AchievementEngine(db, bus, registry, settings, defs);
  engine.start();
  return { engine, bus };
}

const counterTo3 = defineAchievement({
  key: 'counter-3',
  name: 'Counter 3',
  description: 'Trade 3 times.',
  rarity: 'common',
  icon: 'circle',
  target: 3,
  events: ['trade.executed'],
  async onEvent(event, ctx) {
    await ctx.increment(event.gamePlayerId, 1);
  },
});

const secretOnTrade = defineAchievement({
  key: 'secret-one',
  name: 'Secret One',
  description: 'Secret.',
  rarity: 'legendary',
  icon: 'gem',
  target: 1,
  secret: true,
  events: ['trade.executed'],
  async onEvent(event, ctx) {
    await ctx.unlock(event.gamePlayerId);
  },
});

function tradeEvent(gameId: string, gamePlayerId: string, id: string) {
  return {
    type: 'trade.executed' as const,
    gameId,
    gamePlayerId,
    symbol: 'AAPL',
    direction: 'buy' as const,
    quantity: 1,
    price: 100,
    tradeId: id,
    executedAt: new Date().toISOString(),
  };
}

describe('getProgressForPlayer', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeEach(async () => { db = await createTestDb(); });

  it('includes locked non-secret defs and the owner in-progress rows when includeLocked=true', async () => {
    const { gameId, gamePlayerId } = await seedGame(db as unknown as Db);
    const { engine, bus } = makeEngine(db as unknown as Db, [counterTo3]);
    await bus.emit(tradeEvent(gameId, gamePlayerId, 't1')); // counter-3 -> 1/3 in-progress

    const view = await getProgressForPlayer(db as unknown as Db, engine, gameId, gamePlayerId, true);
    expect(view.definitions.map((d) => d.key)).toContain('counter-3');
    const rows = view.progress[gamePlayerId] ?? [];
    const row = rows.find((r) => r.achievementKey === 'counter-3');
    expect(row).toBeDefined();
    expect(row!.unlockedAt).toBeNull();
    expect(row!.progress).toBe(1);
  });

  it('omits in-progress rows when includeLocked=false (definition still listed)', async () => {
    const { gameId, gamePlayerId } = await seedGame(db as unknown as Db);
    const { engine, bus } = makeEngine(db as unknown as Db, [counterTo3]);
    await bus.emit(tradeEvent(gameId, gamePlayerId, 't1'));

    const view = await getProgressForPlayer(db as unknown as Db, engine, gameId, gamePlayerId, false);
    expect(view.definitions.map((d) => d.key)).toContain('counter-3'); // visible (non-secret)
    const rows = view.progress[gamePlayerId] ?? [];
    expect(rows.find((r) => r.achievementKey === 'counter-3')).toBeUndefined(); // in-progress hidden
  });

  it('hides a secret def until the player unlocks it', async () => {
    const { gameId, gamePlayerId } = await seedGame(db as unknown as Db);
    const { engine, bus } = makeEngine(db as unknown as Db, [secretOnTrade]);

    const before = await getProgressForPlayer(db as unknown as Db, engine, gameId, gamePlayerId, true);
    expect(before.definitions.map((d) => d.key)).not.toContain('secret-one');

    await bus.emit(tradeEvent(gameId, gamePlayerId, 't1')); // unlocks secret-one
    const after = await getProgressForPlayer(db as unknown as Db, engine, gameId, gamePlayerId, true);
    expect(after.definitions.map((d) => d.key)).toContain('secret-one');
    const rows = after.progress[gamePlayerId] ?? [];
    expect(rows.find((r) => r.achievementKey === 'secret-one')?.unlockedAt).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter server test -- services/achievement`
Expected: FAIL — `getProgressForPlayer` does not accept a 5th argument / in-progress rows missing / secret leaked. (TypeScript/assertion failures.)

- [ ] **Step 3: Implement the new `getProgressForPlayer`**

In `packages/server/src/services/achievement.ts`, replace the entire
`getProgressForPlayer` function (currently lines ~86-139) with:

```ts
/**
 * Returns the achievement definitions and progress rows for a single player's
 * own catalog view. `definitions` includes every enabled non-secret definition
 * plus any secret definition this player has unlocked. `progress` carries the
 * player's rows; in-progress (locked) rows are included only when
 * `includeLocked` is true — callers pass the requester's ownership so a player
 * cannot read a rival's in-progress counts. `totalEnabledCount` is the game's
 * full enabled count for the `X / Y unlocked` summary.
 */
export async function getProgressForPlayer(
  db: Db,
  engine: AchievementEngine,
  gameId: string,
  gamePlayerId: string,
  includeLocked: boolean,
): Promise<GameAchievementsView> {
  const allDefs = await buildDefinitionDTOs(engine, gameId);
  const totalEnabledCount = allDefs.filter((d) => d.enabled).length;

  const rows = await db
    .select({
      gamePlayerId: schema.achievementProgress.gamePlayerId,
      achievementKey: schema.achievementProgress.achievementKey,
      progress: schema.achievementProgress.progress,
      target: schema.achievementProgress.target,
      unlockedAt: schema.achievementProgress.unlockedAt,
    })
    .from(schema.achievementProgress)
    .where(
      and(
        eq(schema.achievementProgress.gameId, gameId),
        eq(schema.achievementProgress.gamePlayerId, gamePlayerId),
      ),
    );

  const unlockedKeys = new Set<string>();
  for (const row of rows) {
    if (row.unlockedAt !== null) unlockedKeys.add(row.achievementKey);
  }

  const definitions = allDefs.filter(
    (d) => d.enabled && (!d.secret || unlockedKeys.has(d.key)),
  );
  const visibleKeys = new Set(definitions.map((d) => d.key));

  const list: AchievementProgressDTO[] = [];
  for (const row of rows) {
    if (!visibleKeys.has(row.achievementKey)) continue;
    if (row.unlockedAt === null && !includeLocked) continue;
    list.push({
      gamePlayerId: row.gamePlayerId,
      achievementKey: row.achievementKey,
      progress: row.progress,
      target: row.target,
      unlockedAt: row.unlockedAt,
    });
  }

  return {
    definitions,
    progress: { [gamePlayerId]: list },
    totalEnabledCount,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter server test -- services/achievement`
Expected: PASS (all three cases).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/achievement.ts packages/server/tests/services/achievement.test.ts
git commit -m "feat(achievements): per-player view shows locked defs + owner progress, hides secrets"
```

---

## Task 3: Route passes ownership into `getProgressForPlayer`

**Files:**
- Modify: `packages/server/src/routes/achievements.ts:58-93`
- Test: `packages/server/tests/routes/achievements.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/server/tests/routes/achievements.test.ts`, add a new `describe`
block (it can reuse the top-level `registerUser` / `createGame` / `joinGame`
helpers already in the file):

```ts
describe('GET /games/:id/players/:gamePlayerId/achievements', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => { await app.close(); });

  it('owner sees locked non-secret defs and their own in-progress rows', async () => {
    const { token: owner } = await registerUser(app, `u-${Math.random().toString(36).slice(2)}`);
    const game = await createGame(app, owner);
    const { token: bob } = await registerUser(app, `u-${Math.random().toString(36).slice(2)}`);
    const { playerId: bobId } = await joinGame(app, bob, game.id);

    await app.inject({
      method: 'POST',
      url: `/games/${game.id}/trades`,
      headers: { Authorization: `Bearer ${bob}` },
      payload: { symbol: 'AAPL', direction: 'buy', quantity: 1 },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/games/${game.id}/players/${bobId}/achievements`,
      headers: { Authorization: `Bearer ${bob}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      definitions: Array<{ key: string }>;
      progress: Record<string, Array<{ achievementKey: string; unlockedAt: string | null; progress: number }>>;
    }>();
    const keys = body.definitions.map((d) => d.key);
    expect(keys).toContain('first-trade');
    expect(keys).toContain('ten-buys');   // locked, non-secret — now visible
    expect(keys).toContain('champion');   // never-touched, non-secret — visible
    const rows = body.progress[bobId] ?? [];
    const tenBuys = rows.find((r) => r.achievementKey === 'ten-buys');
    expect(tenBuys).toBeDefined();
    expect(tenBuys!.unlockedAt).toBeNull();
    expect(tenBuys!.progress).toBe(1);
  });

  it('does not leak another player\'s in-progress rows to a non-owner', async () => {
    const { token: owner } = await registerUser(app, `u-${Math.random().toString(36).slice(2)}`);
    const game = await createGame(app, owner);
    const { token: bob } = await registerUser(app, `u-${Math.random().toString(36).slice(2)}`);
    const { playerId: bobId } = await joinGame(app, bob, game.id);

    await app.inject({
      method: 'POST',
      url: `/games/${game.id}/trades`,
      headers: { Authorization: `Bearer ${bob}` },
      payload: { symbol: 'AAPL', direction: 'buy', quantity: 1 },
    });

    // owner (a member, but NOT bob) requests bob's achievements
    const res = await app.inject({
      method: 'GET',
      url: `/games/${game.id}/players/${bobId}/achievements`,
      headers: { Authorization: `Bearer ${owner}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      progress: Record<string, Array<{ achievementKey: string; unlockedAt: string | null }>>;
    }>();
    const rows = body.progress[bobId] ?? [];
    expect(rows.length).toBeGreaterThan(0);                       // first-trade is unlocked
    expect(rows.every((r) => r.unlockedAt !== null)).toBe(true);  // no in-progress leaked
    expect(rows.find((r) => r.achievementKey === 'ten-buys')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter server test -- achievements.test`
Expected: FAIL — the owner test fails because the route still drops locked rows
(current `getProgressForPlayer` ignores in-progress), and the call arity is wrong.

- [ ] **Step 3: Update the route to compute ownership**

In `packages/server/src/routes/achievements.ts`, in the
`GET /games/:id/players/:gamePlayerId/achievements` handler, change the `target`
lookup to also select `userId`, then compute ownership and pass it through.
Replace the block from the `const [target] = ...` query through the
`getProgressForPlayer` call (currently lines ~83-91) with:

```ts
        const [targetPlayer] = await db
          .select({ id: gamePlayers.id, userId: gamePlayers.userId })
          .from(gamePlayers)
          .where(and(eq(gamePlayers.id, gamePlayerId), eq(gamePlayers.gameId, gameId)))
          .limit(1);
        if (!targetPlayer) return reply.status(404).send({ error: 'Player not in this game' });

        const includeLocked = targetPlayer.userId === userId;
        const view = await getProgressForPlayer(db, engine, gameId, gamePlayerId, includeLocked);
        return reply.status(200).send(view);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter server test -- achievements.test`
Expected: PASS (both new cases plus the pre-existing ones, which are unchanged).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/achievements.ts packages/server/tests/routes/achievements.test.ts
git commit -m "feat(achievements): owner-scoped in-progress rows on per-player endpoint"
```

---

## Task 4: Frontend — page uses the per-player endpoint and renders all definitions

**Files:**
- Modify: `packages/frontend/src/api/achievements.ts:18-23` (and JSDoc at 5-16)
- Modify: `packages/frontend/src/pages/AchievementsPage.tsx`
- Test: `packages/frontend/tests/pages/AchievementsPage.test.tsx`

- [ ] **Step 1: Fix the per-player response type**

In `packages/frontend/src/api/achievements.ts`, the per-player endpoint returns
progress keyed by the single gamePlayerId (a Record), not an array. Replace the
`PlayerAchievementsResponse` interface with:

```ts
/**
 * Server payload for `GET /games/:gameId/players/:gamePlayerId/achievements`.
 * Same shape as {@link GameAchievementsResponse}: `progress` is keyed by the
 * single requested gamePlayerId. For the owner it includes their in-progress
 * (locked) rows; `definitions` includes all enabled non-secret definitions plus
 * any secret ones that player has unlocked.
 */
export interface PlayerAchievementsResponse {
  definitions: AchievementDefinitionDTO[];
  progress: Record<string, AchievementProgressDTO[]>;
  totalEnabledCount: number;
}
```

Also update the JSDoc on `GameAchievementsResponse` (lines ~5-10) so it no longer
claims locked metadata is never sent — it still holds for the *game-wide*
endpoint, so reword to: "Server payload for `GET /games/:gameId/achievements`
(the game-wide feed source). `definitions` only includes definitions unlocked by
at least one player." (No code change to that interface body.)

- [ ] **Step 2: Write the failing test**

Replace the body of `packages/frontend/tests/pages/AchievementsPage.test.tsx`
(keep the imports/mocks block at the top through `renderPage`, lines 1-54) with
the following `describe`:

```tsx
describe('AchievementsPage', () => {
  function mockGame() {
    mockedUseGame.mockReturnValue({
      data: { id: 'g1', viewerGamePlayerId: 'gp1', leaderboard: [{ playerId: 'u1', gamePlayerId: 'gp1', username: 'alice', cashBalance: 1, totalValue: 1, rank: 1 }] },
      isLoading: false,
    } as unknown as ReturnType<typeof useGame>);
  }

  it('renders unlocked cards AND locked cards for not-yet-unlocked definitions', async () => {
    mockedUseAchievements.mockReturnValue({
      data: {
        definitions: [
          { key: 'a', name: 'Aye',  description: 'unlocked one', rarity: 'common',    icon: 'circle-dot', target: 1, enabled: true, secret: false },
          { key: 'b', name: 'Bee',  description: 'locked one',   rarity: 'legendary', icon: 'gem',        target: 1, enabled: true, secret: false },
        ],
        progress: {
          gp1: [{ achievementKey: 'a', gamePlayerId: 'gp1', progress: 1, target: 1, unlockedAt: '2026-05-23T12:00:00.000Z' }],
        },
        totalEnabledCount: 2,
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useAchievements>);
    mockGame();
    renderPage();
    await waitFor(() => expect(screen.getByText('Aye')).toBeInTheDocument());
    // Locked, non-secret definition is now shown (was hidden before this feature).
    expect(screen.getByText('Bee')).toBeInTheDocument();
  });

  it('shows in-progress count on a locked-but-started card', async () => {
    mockedUseAchievements.mockReturnValue({
      data: {
        definitions: [
          { key: 'c', name: 'Cee', description: 'in progress', rarity: 'uncommon', icon: 'repeat-2', target: 5, enabled: true, secret: false },
        ],
        progress: {
          gp1: [{ achievementKey: 'c', gamePlayerId: 'gp1', progress: 2, target: 5, unlockedAt: null }],
        },
        totalEnabledCount: 1,
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useAchievements>);
    mockGame();
    renderPage();
    await waitFor(() => expect(screen.getByText('Cee')).toBeInTheDocument());
    expect(screen.getByText(/2 \/ 5/)).toBeInTheDocument();
  });

  it('shows the unlock count over totalEnabledCount in the header', async () => {
    mockedUseAchievements.mockReturnValue({
      data: {
        definitions: [
          { key: 'a', name: 'Aye', description: '', rarity: 'common', icon: 'circle-dot', target: 1, enabled: true, secret: false },
        ],
        progress: {
          gp1: [{ achievementKey: 'a', gamePlayerId: 'gp1', progress: 1, target: 1, unlockedAt: '2026-05-23T12:00:00.000Z' }],
        },
        totalEnabledCount: 2,
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useAchievements>);
    mockGame();
    renderPage();
    await waitFor(() => expect(screen.getByText(/1 \/ 2 unlocked/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter frontend test -- AchievementsPage`
Expected: FAIL — "Bee" not found (the page still filters definitions to the
viewer's unlocked set).

- [ ] **Step 4: Update the page**

Rewrite `packages/frontend/src/pages/AchievementsPage.tsx` to use the per-player
endpoint and render every returned definition:

```tsx
import { useParams } from 'react-router-dom';
import { Panel, PanelHeader, PanelBody } from '@/components/panel';
import { AchievementGrid } from '@/components/achievements/AchievementGrid';
import { useAchievements, type PlayerAchievementsResponse } from '@/api/achievements';
import { useGame } from '@/api/games';
import type { AchievementProgressDTO } from '@markettrader/shared';

/**
 * Game-scoped achievements page at `/games/:gameId/achievements`. Shows the
 * full catalog of enabled achievements — locked and unlocked — with the
 * viewer's own progress. Secret achievements appear only after the viewer
 * unlocks them. Peers' progress never appears here.
 */
export function AchievementsPage() {
  const { gameId = '' } = useParams<{ gameId: string }>();
  const game = useGame(gameId);
  const myGamePlayerId = game.data?.viewerGamePlayerId ?? null;
  const view = useAchievements(gameId, myGamePlayerId ?? undefined);

  const data = view.data as PlayerAchievementsResponse | undefined;
  const definitions = data?.definitions ?? [];
  const totalEnabledCount = data?.totalEnabledCount ?? 0;
  const viewerProgress: AchievementProgressDTO[] = myGamePlayerId
    ? data?.progress[myGamePlayerId] ?? []
    : [];
  const unlockedCount = viewerProgress.filter((p) => p.unlockedAt).length;

  return (
    <main className="mx-auto max-w-5xl p-4">
      <Panel>
        <PanelHeader right={<span className="font-mono">{unlockedCount} / {totalEnabledCount} unlocked</span>}>
          Achievements
        </PanelHeader>
        <PanelBody className="flex flex-col gap-4">
          {!myGamePlayerId ? (
            <p className="py-6 text-center text-sm text-muted">
              {game.isLoading ? 'Loading…' : 'Join this game to track achievements.'}
            </p>
          ) : (
            <AchievementGrid
              definitions={definitions}
              progress={viewerProgress}
              totalEnabledCount={totalEnabledCount}
            />
          )}
        </PanelBody>
      </Panel>
    </main>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter frontend test -- AchievementsPage`
Expected: PASS (all three cases).

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/api/achievements.ts packages/frontend/src/pages/AchievementsPage.tsx packages/frontend/tests/pages/AchievementsPage.test.tsx
git commit -m "feat(achievements): achievements page shows locked cards via per-player endpoint"
```

---

## Task 5: Reword the locked tile → "secret"

The grid's `LockedSlotTile` count now equals the number of *hidden secret*
achievements (`totalEnabledCount − definitions.length`), which is 0 until
something is flagged secret. Reword its copy so it never reads as "locked"
next to fully-visible locked cards.

**Files:**
- Modify: `packages/frontend/src/components/achievements/AchievementGrid.tsx:185-214`
- Test: `packages/frontend/tests/pages/AchievementsPage.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to the `describe('AchievementsPage', ...)` block in
`packages/frontend/tests/pages/AchievementsPage.test.tsx`:

```tsx
it('shows a "N secret" tile when enabled count exceeds visible definitions', async () => {
  mockedUseAchievements.mockReturnValue({
    data: {
      definitions: [
        { key: 'a', name: 'Aye', description: '', rarity: 'common', icon: 'circle-dot', target: 1, enabled: true, secret: false },
      ],
      progress: {
        gp1: [{ achievementKey: 'a', gamePlayerId: 'gp1', progress: 1, target: 1, unlockedAt: '2026-05-23T12:00:00.000Z' }],
      },
      totalEnabledCount: 3, // 2 secret achievements not surfaced
    },
    isLoading: false,
  } as unknown as ReturnType<typeof useAchievements>);
  mockedUseGame.mockReturnValue({
    data: { id: 'g1', viewerGamePlayerId: 'gp1', leaderboard: [{ playerId: 'u1', gamePlayerId: 'gp1', username: 'alice', cashBalance: 1, totalValue: 1, rank: 1 }] },
    isLoading: false,
  } as unknown as ReturnType<typeof useGame>);
  renderPage();
  await waitFor(() => expect(screen.getByText(/2 secret/i)).toBeInTheDocument());
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter frontend test -- AchievementsPage`
Expected: FAIL — current copy reads "2 more locked", not "2 secret".

- [ ] **Step 3: Reword `LockedSlotTile`**

In `packages/frontend/src/components/achievements/AchievementGrid.tsx`, update
the JSDoc and the three copy lines inside `LockedSlotTile`:

```tsx
/**
 * Placeholder tile shown after the cards when the game has secret achievements
 * the viewer has not yet unlocked. Reveals only the count — never names,
 * descriptions, or icons.
 */
function LockedSlotTile({ count }: { count: number }) {
```

Then within the returned JSX, change the eyebrow / title / subtitle text:

```tsx
        <div className="font-mono text-[9px] uppercase tracking-[0.22em] mb-1 text-muted">
          Secret
        </div>
        <div className="font-semibold text-text-strong leading-tight text-[13px]">
          {count} secret
        </div>
        <div className="text-[11px] text-muted leading-[1.3] mt-0.5">
          Hidden until you unlock them.
        </div>
```

(Leave the surrounding markup, icon, and `showLockedTile` logic untouched.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter frontend test -- AchievementsPage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/achievements/AchievementGrid.tsx packages/frontend/tests/pages/AchievementsPage.test.tsx
git commit -m "feat(achievements): reword residual tile as secret-count teaser"
```

---

## Task 6: Full verification across the workspace

**Files:** none (verification only).

- [ ] **Step 1: Rebuild shared (ensure declarations are current)**

Run: `pnpm --filter shared build`
Expected: exits 0.

- [ ] **Step 2: Typecheck everything**

Run: `pnpm typecheck`
Expected: exits 0, no errors. (Watch for: the frontend page's `PlayerAchievementsResponse`
cast, and any consumer of the old `PlayerAchievementsResponse.progress` array shape.)

- [ ] **Step 3: Run all tests**

Run: `pnpm test`
Expected: all server + frontend suites pass, including the pre-existing
`GET /games/:id/achievements` test (game-wide endpoint behavior is unchanged)
and the `ack` tests.

- [ ] **Step 4: Lint**

Run: `pnpm lint`
Expected: exits 0.

- [ ] **Step 5: Manual smoke (optional but recommended)**

Use the `run` skill / `pnpm dev`, open a game's achievements page as a member,
and confirm: locked achievements render with name + description; a started-but-
locked achievement shows its `current / target` bar; the header shows the right
`X / Y unlocked`.

- [ ] **Step 6: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "chore(achievements): verification fixups"
```

---

## Self-Review notes (spec coverage)

- Spec §4 (types) → Task 1. ✅
- Spec §5.1 (`getProgressForPlayer` + `includeLocked`) → Task 2. ✅
- Spec §5.2 (route ownership / leak guard) → Task 3. ✅
- Spec §5.3 (`getAchievementsForGame` unchanged logic) → no task needed; only inherits the `secret` field from Task 1's `buildDefinitionDTOs`. Pre-existing game-wide test verifies behavior is unchanged. ✅
- Spec §5.4 (WS/replay/toast/seed untouched) → no task; explicitly out of scope. ✅
- Spec §6.1 (page → per-player) → Task 4. ✅
- Spec §6.2 (locked tile rewording) → Task 5. ✅
- Spec §7 (secret dormant — nothing flagged) → no definition files modified; flag mechanism only. ✅
- Spec §9 (tests) → Tasks 1-5 each add their tests; Task 6 runs the full suite. ✅
