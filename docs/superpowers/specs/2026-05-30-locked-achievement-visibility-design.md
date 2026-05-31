# Locked Achievement Visibility — Design Spec

**Date:** 2026-05-30
**Status:** Approved (brainstorming) — ready for implementation plan
**Author:** Tristan (with Claude Code)

---

## 1. Problem

Locked (unearned) achievements are completely hidden from players. The server
strips any not-yet-unlocked definition out of the player-facing payload, so the
achievements page can only show the viewer's *unlocked* cards plus a generic
"N more locked" placeholder tile. Players cannot see what goals exist or how
close they are to them.

**Goal:** make locked achievements visible to players — name, description, and
the viewer's own progress — so they know what they can unlock and how far along
they are. Add a `secret` flag so individual achievements *can* be kept hidden
until earned (surprise/easter-egg), but flag nothing initially.

---

## 2. Where the locking happens today

- `packages/server/src/services/achievement.ts`
  - `getAchievementsForGame()` and `getProgressForPlayer()` both filter
    definitions to `enabled && unlockedKeys.has(d.key)` and drop every
    in-progress (locked) row. Locked metadata never leaves the server.
- `packages/frontend/src/pages/AchievementsPage.tsx`
  - Re-filters the returned definitions to the viewer's unlocked keys, then
    renders the grid + a "N more locked" count.
- `packages/frontend/src/components/achievements/AchievementCard.tsx`
  - **Already** renders a locked state (`isLocked`: muted icon, "Locked"
    label, dimmed) and an in-progress state (`current > 0`: "In progress",
    `current / target` bar). No new card states needed.
- `packages/frontend/src/components/achievements/AchievementGrid.tsx`
  - Already sorts unlocked-first and renders a `LockedSlotTile` for the
    residual locked count.

### Dual consumption of the game-wide payload (a constraint)

`GET /games/:id/achievements` (`getAchievementsForGame`) feeds **two** consumers:

1. `AchievementsPage` grid (filtered to viewer) — *will move to the per-player
   endpoint.*
2. `GameDetailPage` activity-feed seed — iterates `data.progress` (unlocked
   rows across all players) and looks up `data.definitions.find(...)` for each.
   **This must keep working.**

---

## 3. Decisions (from brainstorming)

| # | Decision |
|---|---|
| D1 | **Approach A:** the catalog grid moves to the per-player endpoint; the game-wide endpoint stays for the activity feed. |
| D2 | Show the viewer's **own progress** on locked cards (in-progress bar). |
| D3 | Add a `secret` flag. Secret achievements are hidden from a player's catalog until *that player* unlocks them. **No achievement is flagged secret initially** — the mechanism ships dormant. |
| D4 | Secret unlocks still surface in the **shared activity feed** (name + icon, non-clickable) as today. The full-description **toast is already viewer-only**, so a peer's secret unlock never reveals its description to others. No clickable per-achievement detail view exists anywhere. |
| D5 | The per-player endpoint must **not** leak one player's in-progress rows to another. Locked rows are returned only to the owner. |

---

## 4. Type changes (`packages/shared`)

`packages/shared/src/types/achievement.ts`:

```ts
export interface AchievementDefinitionDTO {
  // ...existing fields...
  /** When true, hidden from a player's catalog until they unlock it. */
  secret: boolean;
}
```

Notes:
- `secret` is always present in the DTO (non-optional) so consumers don't have
  to defend against `undefined`.
- A secret definition only ever appears in a *player's* payload once that
  player has unlocked it, so exposing the flag leaks nothing.
- Update the JSDoc on `AchievementDefinitionDTO` and the two response
  interfaces in `packages/frontend/src/api/achievements.ts` to reflect that
  `definitions` now includes locked (non-secret) definitions.

`packages/server/src/achievements/define.ts`:

```ts
export interface AchievementDefinition<...> {
  // ...existing fields...
  /** Optional. When true, hidden from the catalog until the player unlocks it. Default false. */
  secret?: boolean;
}
```

`buildDefinitionDTOs()` in `services/achievement.ts` maps `secret: d.secret ?? false`.

No DB schema change — `secret` is code-defined metadata, exactly like `rarity`
and `icon` (which are never persisted).

---

## 5. Server changes (`packages/server/src/services/achievement.ts`)

### 5.1 `getProgressForPlayer` — the catalog source for the viewer

New signature:

```ts
getProgressForPlayer(db, engine, gameId, gamePlayerId, includeLocked: boolean)
```

Behavior:
- Build `allDefs` (now carrying `secret`). `totalEnabledCount` =
  count of enabled defs (unchanged — still the full denominator).
- Compute this player's `unlockedKeys` from their rows.
- **Definitions returned** = enabled defs where `!d.secret || unlockedKeys.has(d.key)`.
  (All non-secret enabled defs, plus secret ones this player has unlocked.)
- **Progress rows returned**, for each of this player's rows whose key is in the
  visible set:
  - If `row.unlockedAt !== null` → include (unchanged).
  - Else (in-progress/locked) → include **only when `includeLocked` is true**.

This yields: locked non-secret cards with the viewer's real progress, unlocked
cards as before, secret cards only after the viewer earns them.

### 5.2 Route `GET /games/:id/players/:gamePlayerId/achievements`

`packages/server/src/routes/achievements.ts` — after the existing
membership + target-player checks, compute ownership and pass it through:

```ts
const owner = target.userId === userId;   // target row must also select userId
const view = await getProgressForPlayer(db, engine, gameId, gamePlayerId, owner);
```

(The route currently selects only `gamePlayers.id` for `target`; add
`gamePlayers.userId` to the select.)

**Leak guard (D5):** a non-owner requesting another player's achievements gets
unlocked-only rows — today's behavior — so no one can read a rival's in-progress
counts (e.g. "18/20 toward Wendy's"). There is no current non-owner consumer,
but the endpoint is reachable by any game member, so the guard is required.

### 5.3 `getAchievementsForGame` — game-wide, feeds the activity seed

**Logic unchanged.** Its only remaining consumer is the `GameDetailPage`
activity-feed seed, which reads definitions solely for keys that appear in
unlocked `progress` rows. So it keeps returning definitions for
unlocked-by-anyone keys (which already includes unlocked secrets — required by
D4 so a peer's secret unlock can render in the feed) and unlocked-only progress
for all players. The only difference is that each returned definition now
carries the new `secret` field automatically via `buildDefinitionDTOs` — no
filtering change. We deliberately do **not** add locked definitions here: the
page that needs them uses the per-player endpoint, and bloating the game-wide
payload with all definitions serves no consumer.

### 5.4 Explicitly unchanged

- `engine.ts` WS `achievement_unlocked` broadcast.
- Connect-time replay (`lastSeenUnlockAt`).
- `useAchievementUnlockStream` toast bridge (already viewer-only).
- `GameDetailPage` activity-feed seed logic.
- `getAdminAchievementsForGame` (already returns the full registry).

---

## 6. Frontend changes

### 6.1 `AchievementsPage.tsx`
- Fetch via the per-player endpoint for the viewer:
  `useAchievements(gameId, myGamePlayerId)` (only when `myGamePlayerId` is set;
  fall back to empty state otherwise).
- Pass **all** returned definitions to `AchievementGrid` — delete the
  `viewerDefinitions = definitions.filter(unlocked)` step. The viewer's progress
  array drives unlocked vs. in-progress vs. locked per card.
- `unlockedCount` = count of the viewer's rows with `unlockedAt`. Header still
  reads `unlockedCount / totalEnabledCount`.
- Narrow on the per-player `progress` shape (`AchievementProgressDTO[]`), not the
  game-wide `Record<string, ...>`.

### 6.2 `AchievementGrid.tsx`
- No structural change. `lockedRemaining = totalEnabledCount − definitions.length`
  now equals the count of **hidden secret** achievements (0 while nothing is
  flagged secret, so the tile is hidden).
- Reword `LockedSlotTile`: replace "N more locked" / "Keep playing to discover
  what's left" copy so it reads as a secret teaser (e.g. eyebrow "Secret",
  body "N secret"). It must not read as "locked" now that fully-visible locked
  cards sit in the same grid.

### 6.3 `AchievementCard.tsx`
- No change required. Locked (`current === 0`) and in-progress (`current > 0`)
  states already render correctly.

---

## 7. Secret achievement mechanism (dormant)

- Add `secret?: boolean` to the definition interface (default false).
- **Flag nothing initially.** Every one of the 59 achievements stays visible
  when locked.
- To make an achievement secret later: set `secret: true` in its definition
  file under `packages/server/src/achievements/definitions/`. No migration, no
  other change. Candidate set for the future (not applied now): Achievement
  Horse, Six Seven, Sir This Is a Wendy's, Stonks, This Is Fine, Speedrun
  Any %, Dollar Menu, One Share Wonder, Penny Stock Enjoyer.

---

## 8. Edge cases

- **Viewer with no `gamePlayerId`** (not a member / spectator): page shows empty
  state; do not call the per-player endpoint with a null id.
- **In-progress rows with `progress === 0`**: render as `isLocked` (the card
  already treats `current === 0` as locked) — correct.
- **Disabled achievements**: still excluded everywhere (the `enabled` filter is
  unchanged); they do not count toward `totalEnabledCount`.
- **Orphaned progress rows** (key no longer in registry): not in `allDefs`, so
  never surface in the player view — unchanged.
- **Secret unlocked by a peer**: appears in the shared activity feed (name +
  icon, non-clickable). Does not appear in a non-earner's catalog grid, and the
  description-bearing toast is viewer-only. (Moot until something is flagged
  secret, but the design holds.)

---

## 9. Testing plan

### Server (`tests/routes/achievements.test.ts`, `tests/achievements/*`)
- **Existing game-wide assertion stays:** the test that locked achievements
  (e.g. `ten-buys`, `rock-bottom`) are **absent** from `GET /games/:id/achievements`
  remains valid — that endpoint's logic is unchanged. (It may need a tolerant
  match if it deep-equals the definition shape, since each def now carries
  `secret`.)
- **New, on the per-player endpoint** (`GET /games/:id/players/:gpid/achievements`,
  owner): locked *non-secret* achievements are now **present** in `definitions`,
  and the owner gets their in-progress rows (progress > 0, `unlockedAt: null`).
- **Leak guard:** player B requesting player A's achievements receives
  unlocked-only rows — none of A's in-progress rows; A's locked definitions may
  appear (they're not secret) but with no progress numbers.
- `secret: true` (use a test-only definition or temporarily flag one): hidden
  from a non-earner's per-player payload; revealed to the earner after unlock;
  appears in the game-wide payload once unlocked-by-anyone (feed path).
- `totalEnabledCount` unchanged as the full enabled denominator.

### Frontend (`tests/pages/AchievementsPage.test.tsx`, grid tests)
- Locked non-secret card renders name + description with the "Locked" label.
- In-progress card renders the `current / target` bar.
- Unlocked card unchanged.
- Header shows `unlocked / totalEnabledCount`.
- Secret-locked definition absent from the rendered grid (when the fixture marks
  one secret); reworded secret tile shows the right count.

---

## 10. Out of scope

- Per-achievement detail page/modal (none exists; not adding one).
- Changing the WS broadcast / toast / replay / activity-feed behavior.
- Showing peers' progress to each other.
- Admin UI changes beyond the `secret` flag being available in the DTO (a
  "Secret" badge in the admin card is optional polish, not required).
- Persisting `secret` to the database.
