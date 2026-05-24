# Achievements — Frontend Design Spec

**Status:** Draft
**Date:** 2026-05-23
**Companion to:** [2026-05-23-achievements-system-design.md](./2026-05-23-achievements-system-design.md) (backend)
**Branch:** `feat/achievements-system`

---

## Context

The backend spec scaffolds the engine, event bus, DB tables, and REST + WS surfaces for game-scoped achievements. That spec explicitly punted "rarity, point values, leaderboard weighting" and "frontend (panel, toast, hooks)" to a follow-up. This is the follow-up for both — it pulls rarity back into scope because rarity drives the entire visual language.

Design goals:

1. **Respect the existing aesthetic.** Dark `#0a0b0d` background, hairline borders, Geist Sans + Geist Mono, cyan `#67e8f9` accent, restrained color use. Rarity should land **inside** that vocabulary, not on top of it (see Podium's medal-glow precedent at `packages/frontend/src/components/leaderboard/Podium.tsx`).
2. **Reveal moments matter.** Unlocks are rare (a few per game), so the unlock animation can have presence — but still subtle, not confetti. Single, well-orchestrated reveal in the spirit of the existing `pulse-dot` / Podium glow.
3. **Rarity carries weight.** A common unlock and a legendary unlock must read as fundamentally different at a glance, without saturating the chrome.
4. **You-only toasts.** Other players' unlocks live in the achievements panel/roster, not as toasts. The toast is a personal moment.

---

## Decisions captured in brainstorm

| # | Decision | Why |
|---|---|---|
| 1 | At-rest rarity expression: **accent + tinted glow** (not whisper, not filled chip) | Matches Podium's existing radial-gradient medal-glow language; rarity is felt at a glance without dominating |
| 2 | Icon system: **one Lucide icon per achievement** (not category-derived, not typographic-only) | ~1500 monoline icons, same stroke weight as existing chrome; gives at-a-glance recognizability without bespoke art |
| 3 | Unlock animation: **two-beat reveal** (lift in → icon flare → expanding ring → halo settles) | More impact than a simple slide; less than a sweep/loot-drop; halo lingers consistent with at-rest treatment |
| 4 | Panel layout: **2-column grid of cards + rarity filters + roster** | Best at-a-glance scanning; keeps rarity color visible; roster as compact rolled-up summary at the bottom |
| 5 | Toast placement: **top-center banner, queued one-at-a-time** | Each unlock gets its own moment; strict queue, full ceremony each (own-unlock bursts are rare and worth the time) |
| 6 | Toast scope: **you-only** — peer unlocks render only in panel/roster | A toast is a personal celebration; peer activity belongs in the browseable view |
| 7 | Locked-state: **always visible, name + description shown**, muted styling | Goal-setting affordance — players can see what to chase |
| 8 | Panel location: **dedicated route `/games/:id/achievements`** | Roomy enough for grid + roster + filters; matches existing per-game route shape |
| 9 | Rarity in data: **string literal in `defineAchievement()`** (no DB column for definitions) | Rarity is code-defined alongside name/description; consistent with the existing definition model |

---

## Rarity tokens

Five rarities, each a single hex value. Added to `index.css` alongside the existing player-series tokens:

```css
:root, .dark {
  --r-common:    #9ca3af;  /* gray-400  */
  --r-uncommon:  #34d399;  /* emerald-400 */
  --r-rare:      #60a5fa;  /* blue-400  */
  --r-epic:      #a78bfa;  /* purple-400 */
  --r-legendary: #f59e0b;  /* amber-500 */
}

/* Light theme — slightly darker / less saturated for AA contrast on cream */
html:not(.dark) {
  --r-common:    #6b7280;  /* gray-500  */
  --r-uncommon:  #047857;  /* emerald-700 */
  --r-rare:      #1d4ed8;  /* blue-700  */
  --r-epic:      #7c3aed;  /* violet-600 */
  --r-legendary: #b45309;  /* amber-700 */
}
```

Halo opacity scales with rarity — uncommons whisper, legendaries breathe. Per-rarity helper class:

```css
.rar-common    { --rarity: var(--r-common);    --rarity-glow: rgba(156,163,175,0.06); }
.rar-uncommon  { --rarity: var(--r-uncommon);  --rarity-glow: rgba(52,211,153,0.08); }
.rar-rare      { --rarity: var(--r-rare);      --rarity-glow: rgba(96,165,250,0.10); }
.rar-epic      { --rarity: var(--r-epic);      --rarity-glow: rgba(167,139,250,0.14); }
.rar-legendary { --rarity: var(--r-legendary); --rarity-glow: rgba(245,158,11,0.18); }
```

Light-theme glow opacities are doubled (the halo needs more saturation to register on cream): e.g. `rgba(180, 83, 9, 0.10)` for legendary. Exact values resolved during implementation against the live cream surface.

Tailwind exposure: extend `tailwind.config.ts` to expose `rarity-{common|uncommon|rare|epic|legendary}` color tokens that read from these CSS vars, so component code can use `text-rarity-legendary` etc. when not driving via the `.rar-*` class.

The hex values above intentionally re-use the existing `--p2`..`--p8` player palette (epic = purple = `--p2`, legendary = amber = `--p3`). Rarity tokens are duplicated rather than aliased so they can evolve independently if a future player-palette change would clash.

---

## Showing each unlock exactly once

The backend already broadcasts `achievement_unlocked` exactly once per unlock (see `markUnlocked()` in `packages/server/src/achievements/engine.ts`: `UPDATE … WHERE unlocked_at IS NULL` + only broadcast on the row-changed transition). That handles the happy path while the player is connected. But the toast still needs to behave correctly across four failure modes:

| Scenario | What can go wrong without explicit handling |
|---|---|
| Player **offline** when the unlock happens | They miss the toast forever |
| Player **refreshes** mid-toast (before any ack) | A naive replay would re-toast |
| **React StrictMode** double-mounts the WS hook in dev | Same frame fed to two effect runs → double-toast |
| Player has **multiple tabs** open | Each tab subscribes independently → toast in both |

The chosen mechanism is **server-replay on WS connect + client ack on toast dismiss + localStorage marker as belt-and-braces.** Two layers, each handling a different subset of the failure modes.

### Layer 1 — Server replay on WS connect

One new column on `gamePlayers`:

```ts
// schema.{sqlite,pg}.ts
gamePlayers = {
  …,
  lastSeenUnlockAt: text('last_seen_unlock_at'),  // ISO 8601 nullable; pg uses timestamp
}
```

Migration: nullable column, no backfill needed. Existing rows default `NULL`, which means "the player has seen no unlocks yet" — first connect replays everything currently unlocked, which is the right behavior for a feature being introduced mid-game.

Wire into the existing WS upgrade handler (`packages/server/src/ws/live-route.ts`, sits next to auth + room-join):

1. Authenticate JWT → resolve `gamePlayerId`.
2. Load that player's `lastSeenUnlockAt`.
3. `SELECT achievement_key, unlocked_at FROM achievement_progress WHERE game_player_id = ? AND unlocked_at IS NOT NULL AND unlocked_at > coalesce(?, '1970-01-01') ORDER BY unlocked_at ASC`.
4. For each row, send an `achievement_unlocked` frame in chronological order, hydrating `name`/`description`/`rarity`/`icon` from the in-memory definition registry.
5. **Do NOT advance `lastSeenUnlockAt` here** — the client acks instead (Layer 2). This way, a mid-replay disconnect re-replays the un-acked entries on the next connect.

Each replayed frame carries a new optional flag so the client can adjust copy:

```ts
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
    replayed?: boolean;     // true when sent from connect-time replay; false/undefined for live
  };
}
```

Toast eyebrow when `replayed === true`: `"{RARITY} · UNLOCKED · {RELATIVE TIME}"` (e.g. `"LEGENDARY · UNLOCKED · 2H AGO"`). Live unlocks stay `"{RARITY} · UNLOCKED"`. Animation is identical — a replayed unlock still earns its ceremony.

### Layer 2 — Client ack + localStorage marker

One new REST endpoint:

```
POST /api/games/:gameId/players/:gamePlayerId/achievements/ack
body: { unlockedAt: string }
```

Implementation: `UPDATE game_players SET last_seen_unlock_at = greatest(last_seen_unlock_at, ?) WHERE id = ?` (use `MAX(coalesce(last_seen_unlock_at, '1970-01-01'), ?)` for SQLite which lacks `greatest`). Idempotent; safe to retry. Auth: caller must be the player or an admin.

Client behavior:

1. Each `AchievementToast` calls the ack endpoint when its lifecycle completes (auto-dismiss after 6s display, or × button). Failures log and silently retry once; persistent failure is non-fatal (next connect's replay catches it).
2. Client also writes `last_seen_unlock_at:{gameId}:{gamePlayerId}` = the same ISO timestamp to `localStorage` on every ack, AND on every dismissed toast even if the ack request is in flight.
3. `useAchievementUnlockStream` checks each incoming WS frame's `unlockedAt` against the localStorage marker **before** enqueuing. If `frame.unlockedAt <= marker`, drop silently. This is the belt-and-braces against StrictMode, mid-toast refresh, and ack-in-flight.
4. The Zustand toast store also de-dups by `(achievementKey, unlockedAt)` on enqueue — a third safety net for any in-session double-emit (e.g. simultaneous live frame + replay frame during a reconnect race).

### Behavior matrix

| Scenario | Outcome |
|---|---|
| Single live unlock, player connected | WS frame arrives → localStorage marker stale → enqueue → toast plays → dismiss → ack fires → both markers advance |
| Player offline at unlock time, reconnects an hour later | Replay frame on connect (`replayed: true`) → localStorage marker stale → enqueue → toast plays with "1H AGO" eyebrow → ack on dismiss advances markers |
| Player refreshes mid-toast (before ack fired) | WS reconnects → server replays same frame → localStorage marker advanced *iff* the previous dismissal touched it; if not, toast plays once more, ack on dismiss advances. Worst case: one re-show after an interrupted dismissal |
| React StrictMode double-mount | Hook subscribes twice → same WS frame fed twice → store de-dup by `(key, unlockedAt)` drops the second; no toast doubles |
| Two tabs open | Each tab subscribes independently → both toast. First tab to dismiss acks. Second tab's localStorage is per-tab so it doesn't learn until next page load. **Two simultaneous toasts of the player's own unlock across two of their own tabs is acceptable** — flagged here so it doesn't surprise anyone |
| localStorage cleared / private browsing | Server `lastSeenUnlockAt` still gates replay scope. The player only re-sees unlocks that haven't been acked yet — a clean ack history means no re-show after the marker is gone |

### Why not just trust `lastSeenUnlockAt` alone?

Two reasons we keep the localStorage marker:

1. The server marker only advances on ack, and acks fire on toast dismiss. If the player closes the tab mid-toast, no ack fires; next connect would replay; without a localStorage marker the same toast could play on every reconnect until the player completes a dismiss. The localStorage marker is updated on the dismissal itself (synchronously, before the ack network request), so a closed-tab-mid-toast scenario at least prevents the in-tab replay after a refresh in the same browser.
2. StrictMode double-emit during dev would double-toast without a client-side de-dup. The store-level `(key, unlockedAt)` de-dup handles it without needing a server round-trip.

### What's added to the data model summary

| Field | Where | Purpose |
|---|---|---|
| `gamePlayers.lastSeenUnlockAt: text/timestamp \| null` | New column (both schemas) | Server-side high-water mark of acknowledged unlocks |
| `POST /api/games/:gameId/players/:gamePlayerId/achievements/ack` body `{ unlockedAt: string }` | New route | Client confirms display; idempotent `MAX(current, body)` update |
| `WsAchievementUnlockedEvent.data.replayed?: boolean` | Existing DTO | Distinguishes connect-time replays from live unlocks |
| `localStorage["last_seen_unlock_at:{gameId}:{gamePlayerId}"]` | Client | Pre-WS-enqueue de-dup; survives ack-network failure |

This work belongs in the same PR as the rest of the frontend — the migration + WS handler + REST endpoint are small and the design depends on them.

---

## Backend changes required

This spec amends — not replaces — the backend spec. Three additions:

### 1. `defineAchievement()` gains `rarity` and `icon`

```ts
// packages/server/src/achievements/define.ts
export type AchievementRarity =
  | 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export interface AchievementDefinition<TEvents extends DomainEventType = DomainEventType> {
  key: string;
  name: string;
  description: string;
  category?: string;
  rarity: AchievementRarity;         // required
  icon: string;                      // required — Lucide icon name in kebab-case, e.g. 'flame', 'trending-up'
  target: number;
  events: readonly TEvents[];
  onEvent(event: DomainEventOf<TEvents>, ctx: AchievementContext): void | Promise<void>;
}
```

Both fields are **required** rather than optional + defaulted. The three already-committed definitions (`first-trade`, `ten-buys`, `rock-bottom`) get edited as part of this work:

| Definition | rarity | icon |
|---|---|---|
| `first-trade` | `common` | `circle-dot` |
| `ten-buys` | `uncommon` | `repeat-2` |
| `rock-bottom` | `epic` | `trending-down` |

Icon validation: at engine startup (in `engine.ts`'s registry build step), validate that every definition's `icon` is a non-empty kebab-case string. We deliberately do not validate it exists in `lucide-react` from the server (no Lucide dep on the server side); the frontend's `getIcon(name)` helper handles missing icons by falling back to a generic `Award` icon and logging once per session.

### 2. DTOs gain `rarity` and `icon`

```ts
// packages/shared/src/types/achievement.ts
export type AchievementRarity =
  | 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export interface AchievementDefinitionDTO {
  key: string;
  name: string;
  description: string;
  category?: string;
  rarity: AchievementRarity;
  icon: string;                  // Lucide kebab-case name
  target: number;
  enabled: boolean;
}
```

`AchievementProgressDTO` is unchanged — rarity isn't snapshotted onto the progress row. Definitions are the source of truth for rarity; a future rarity edit applies retroactively. This is acceptable because (a) rarity values won't change often, (b) the player-facing impact of a rarity downgrade is purely cosmetic, and (c) keeping definition fields out of the progress row preserves the spec's `target`-is-the-only-snapshot rule.

### 3. WebSocket event gains `rarity` and `icon`

This is the load-bearing change — the toast must render without a follow-up fetch:

```ts
export interface WsAchievementUnlockedEvent {
  event: 'achievement_unlocked';
  data: {
    gamePlayerId: string;
    achievementKey: string;
    name: string;
    description: string;
    rarity: AchievementRarity;   // new
    icon: string;                // new
    unlockedAt: string;
    replayed?: boolean;          // new — true when sent from connect-time replay; see "Showing each unlock exactly once"
  };
}
```

The engine reads `name`, `description`, `rarity`, `icon` from the in-memory definition registry when broadcasting (no extra DB read). `replayed` is set by the WS connect handler when emitting from the catch-up loop; live broadcasts from the engine leave it `undefined` (treated as `false` by the client).

---

## Frontend file layout

```
packages/frontend/src/
  components/
    achievements/
      AchievementCard.tsx           # the shared card chrome (icon + body + progress)
      AchievementGrid.tsx           # 2-col grid + rarity/category/locked chip filters
      AchievementRoster.tsx         # per-player rollup at the bottom of the panel
      AchievementToast.tsx          # the unlock toast (two-beat reveal)
      AchievementToastHost.tsx      # top-center container, mounted once at app root
      icon.ts                       # Lucide name → component lookup with fallback
      rarity.ts                     # rarity → token + label mapping
  pages/
    AchievementsPage.tsx            # /games/:id/achievements route
  hooks/
    useAchievements.ts              # React Query hook (definitions + progress)
    useAchievementUnlockStream.ts   # subscribes to WS, dedups vs localStorage marker, pushes own-unlocks to the toast store
  stores/
    achievementToastStore.ts        # Zustand: queued own-unlocks + currently displayed; dedups by (key, unlockedAt)
  lib/
    achievementSeenMarker.ts        # localStorage helper: read/write per-(gameId, gamePlayerId) "last seen" timestamp; ack to server
```

Routing: register the route in the existing router (currently in `App.tsx` or `pages/` index) as `/games/:gameId/achievements`. Add an "Achievements" link to the game-scoped nav inside `AppHeader.tsx` (matches the existing "Portfolio" / "Game" links).

---

## The achievement card (at rest)

Shared chrome used by `AchievementGrid` and `AchievementToast`. ASCII anatomy:

```
┌──────────────────────────────────────────┐
│░░░░░░░░ rarity-tinted top halo ░░░░░░░░░│
│▍                                         │
│▍  [icon]    LEGENDARY                    │
│▍            Diamond Hands                │
│▍            Hold a position…             │
│▍                                         │
│▍            ████████████  1 / 1          │
└──────────────────────────────────────────┘
 ▲                                         ▲
 │                                         │
3px rarity left bar              hairline-strong border
```

Component contract:

```tsx
interface AchievementCardProps {
  definition: AchievementDefinitionDTO;
  progress: AchievementProgressDTO | null;   // null = never touched, render as 0/target
  variant?: 'grid' | 'toast' | 'roster';     // controls padding + icon size only
  className?: string;
}
```

Visual rules (verbatim from approved mockups):

- Container: `rounded-panel border border-hairline-strong bg-panel` (existing `Panel` tokens), 14px vertical / 16px left padding, `28px 1fr` grid (icon | body).
- Rarity left bar: `::before` pseudo, `3px` wide, full height, `background: var(--rarity)`.
- Rarity glow: `::after` pseudo, `radial-gradient(120% 70% at 50% -20%, var(--rarity-glow) 0%, transparent 60%)`, fades from top.
- Icon: 22px × 22px Lucide icon, stroke `1.6`, color `var(--rarity)`.
- Tier eyebrow: Geist Mono, `9px`, `letter-spacing: 0.22em`, uppercase, color `var(--rarity)`.
- Name: Geist Sans, `13px` (grid) / `15px` (toast), `font-weight: 600`, color `var(--text-strong)`.
- Description: Geist Sans, `11px`, color `var(--muted)`.
- Progress bar: `3px` tall, `var(--hairline)` track, fill `var(--rarity)`.
- Progress label: Geist Mono, `10px`, color `var(--muted)`, `font-variant-numeric: tabular-nums`. Unlocked state shows `"unlocked · {relative time}"`.

**Locked variant** (`progress.unlockedAt === null && progress.progress === 0`):

- `opacity: 0.55`.
- Left bar: `var(--hairline-strong)` instead of rarity.
- Glow: hidden.
- Icon + tier label: `var(--muted)` instead of rarity.
- Name + description: **always shown** (no `???` hiding — confirmed in brainstorm).
- Progress bar still renders, in `var(--hairline)`.

**In-progress variant** (`progress.unlockedAt === null && progress.progress > 0`):

- Full rarity styling (bar, glow, icon color), but with a slight overall opacity reduction (`opacity: 0.85`) and the tier eyebrow reads "IN PROGRESS · {RARITY}" instead of just the rarity name. Progress bar shows current fill.

**Featured layout** — in the grid, legendary unlocked cards span both columns (`grid-column: span 2`) so they breathe. This is purely a grid concern; the card itself doesn't know.

---

## The unlock toast — two-beat reveal

Mounted inside `AchievementToastHost`, a single instance rendered at the app root (inside `AppShell`, sibling to the routed view). Position: `fixed; top: 76px` (below the existing ticker), `left: 50%; transform: translateX(-50%)`, `z-index: 50`. Width: `420px`, capped to `min(420px, calc(100vw - 32px))` for narrow viewports.

Animation timing — copied verbatim from the approved mockup, do not re-tune:

| Element | Animation | Duration | Easing | Delay |
|---|---|---|---|---|
| Card wrapper | rise (`translateY(-14px) → 0`, opacity 0 → 1, scale 0.985 → 1) | 380ms | `cubic-bezier(0.22, 1, 0.36, 1)` | 0 |
| Rarity left bar (`::before`) | scaleY top 0 → 1, opacity 0 → 1 | 320ms | `ease-out` | 60ms |
| Halo (`::after`) | opacity 0 → 1 → 0.55 (keyframes: 0%, 35%, 100%) | 1400ms | `cubic-bezier(0.16, 1, 0.3, 1)` | 120ms |
| Icon flare (radial burst behind SVG) | opacity 0 → 1 → 0, scale 0.4 → 1.15 → 1.8 | 700ms | `cubic-bezier(0.16, 1, 0.3, 1)` | 140ms |
| Icon SVG | opacity 0 → 1, scale 0.55 → 1.18 → 1, rotate −10° → 3° → 0 | 520ms | `cubic-bezier(0.34, 1.56, 0.64, 1)` | 120ms |
| Outer ring (1.5px border, full toast inset −2px, 7px radius) | opacity 0 → 1 → 0, scale 0.985 → 1.06 | 900ms | `cubic-bezier(0.22, 1, 0.36, 1)` | 180ms |
| Text (eyebrow + name + desc) | opacity 0 → 1, `translateX(-4px → 0)` | 460ms | `cubic-bezier(0.22, 1, 0.36, 1)` | 220ms |

Implementation: pure CSS keyframes in a co-located `AchievementToast.module.css` or via Tailwind's `keyframes` + `animation` config. **All animations use `animation-fill-mode: both`** (`both` so the pre-delay state is the 0% keyframe and the post-completion state is the 100% keyframe — that's how the halo lingers at `opacity: 0.55` and the icon settles at scale 1). **No Motion / Framer Motion** — keeps the dep surface tight and the existing CSS-keyframe convention (`marquee`, `pulse-dot`) consistent.

The halo's final keyframe at `opacity: 0.55` becomes the toast's steady state for its entire lifetime (same as the at-rest card glow). The card's box-shadow stays at `0 8px 24px rgba(0,0,0,0.45)` throughout.

### Reduced-motion fallback

`index.css` already has a global `@media (prefers-reduced-motion: reduce)` that clamps every animation to 0.01ms. Under that rule, the toast simply appears at its final state: card present, bar at scale 1, halo at 0.55 opacity, icon at scale 1, text in place, ring invisible (no pulse, no flare). Acceptable as-is — no per-toast override needed.

### Queue + lifecycle

`achievementToastStore` (Zustand):

```ts
interface AchievementToast {
  id: string;          // crypto.randomUUID at enqueue time
  unlock: WsAchievementUnlockedEvent['data'];
  enqueuedAt: number;
}

interface AchievementToastStore {
  current: AchievementToast | null;
  queue: AchievementToast[];
  enqueue(unlock: WsAchievementUnlockedEvent['data']): void;
  dismiss(id: string): void;
  _advance(): void;     // internal — pops queue head into current
}
```

- `useAchievementUnlockStream` subscribes to the WS, filters for `event === 'achievement_unlocked'` where `gamePlayerId === currentPlayerId`, calls `enqueue`. Peer unlocks are dropped at this filter — no toast.
- Display rule: hold each toast for **6 seconds** after the entrance animation completes (~1.5s), then auto-dismiss. Manual dismiss via × button advances immediately.
- Exit animation: 220ms `translateY(0 → -12px)` + opacity 1 → 0, `ease-in`. After exit, `_advance()` pops the next queued toast.
- Strict serial queue — no stacking, full ceremony each (confirmed in brainstorm). Worst-case bursts of own-unlocks (end-of-game) play through in arrival order over ~22s.

### "You unlocked" eyebrow

The eyebrow always reads `"{RARITY} · UNLOCKED"` for own-toasts. Since toasts only fire for own-unlocks, there's no "alex unlocked" variant — that wording lives in the panel's activity stream.

---

## The achievements page

Route: `/games/:gameId/achievements`. Renders inside the existing `AppShell` chrome (header + ticker). Page-level layout:

```
┌── Panel chrome ────────────────────────────────────────────┐
│ Achievements                              4 / 12 unlocked  │  ← PanelHeader
├────────────────────────────────────────────────────────────┤
│                                                            │
│ [All] [Common] [Uncommon] [Rare] [Epic] [Legendary]        │  ← rarity chip row
│ ──────────────────────────────  [Unlocked] [Locked]        │  ← state chips, right-aligned
│                                                            │
│ ┌──────────────┐ ┌──────────────┐                          │
│ │ Card         │ │ Card         │                          │  ← 2-col grid
│ └──────────────┘ └──────────────┘                          │
│ ┌──────────────┐ ┌──────────────┐                          │
│ │ Card         │ │ Card         │                          │
│ └──────────────┘ └──────────────┘                          │
│ ┌────────────────────────────────────────┐                 │
│ │ Featured legendary card (col span 2)   │                 │
│ └────────────────────────────────────────┘                 │
│                                                            │
│ ┌── Other players ─────────────────────────────────────┐   │
│ │ OTHER PLAYERS                                        │   │
│ │ tristan  YOU            4 unlocked · 1 leg.          │   │
│ │ alex                    7 unlocked · 2 leg.          │   │
│ │ sam                     2 unlocked · 0 leg.          │   │
│ └──────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────┘
```

### Filter behavior

- Rarity chips: multi-select with one chip per rarity + an "All" toggle that clears the others. Active chips render with the rarity's tinted background (`rgba(rarity, 0.06)`) and `rgba(rarity, 0.35)` border (same pattern as the existing accent-active chip).
- State chips (Unlocked / Locked): mutually exclusive with a "no filter" default.
- Category chips (`trading`, `risk`, `milestone`, …): only render if `>=2` distinct categories exist in the definition list. Pulled from `definition.category`. Generated client-side from the definitions response.
- All filters are reflected in URL search params (`?rarity=epic,legendary&state=unlocked`) so a filtered view is link-shareable.

### Sorting

Default sort: **legendary first, then epic, rare, uncommon, common; within rarity, unlocked first, then by ascending `key`.** This pushes the rare-and-earned to the top of the grid where the rarity glow lands hardest.

### Roster (other players)

```tsx
interface RosterEntry {
  gamePlayerId: string;
  username: string;
  isCurrentPlayer: boolean;
  unlockedCount: number;
  rarityBreakdown: Record<AchievementRarity, number>;  // counts of unlocked by rarity
}
```

Derivation: from `GET /api/games/:gameId/achievements`, group the `progress` map by `gamePlayerId`, count entries where `unlockedAt !== null`, bucket those by their definition's rarity. Render a row per player, current player first (with cyan `YOU` chip), then by `unlockedCount` descending.

Each row: `{username} [YOU] ─── {unlockedCount} unlocked · {legendaryCount} leg.` The legendary-count callout exists because legendaries are the social currency; epics through commons stay rolled into the total.

Clicking a roster row navigates to `/games/:gameId/achievements?player={gamePlayerId}` which scopes the grid to that player's progress (header gains a "Viewing alex's progress · ← back to mine" affordance). This reuses the existing `GET /api/games/:gameId/players/:gamePlayerId/achievements` endpoint.

### Responsive

- ≥ 768px: 2-column grid as drawn.
- 480–767px: single-column grid. Featured legendary loses its `span 2` (already only one column).
- < 480px: single column, toast width drops to `calc(100vw - 16px)`, rarity filter chips wrap to two rows.

---

## React Query + data flow

```ts
// hooks/useAchievements.ts
export function useAchievements(gameId: string, playerId?: string) {
  return useQuery({
    queryKey: ['achievements', gameId, playerId ?? 'all'],
    queryFn: () => playerId
      ? api.getPlayerAchievements(gameId, playerId)
      : api.getGameAchievements(gameId),
    staleTime: 30_000,
  });
}
```

On `achievement_unlocked` WS event:
1. `useAchievementUnlockStream` reads the event.
2. If `gamePlayerId === currentPlayerId`, push to the toast store.
3. Always: invalidate `['achievements', gameId]` so the next render of the page reflects the new unlock without a refetch round-trip.

The WS connection itself is already established by the existing game-page WS hook — we add the `achievement_unlocked` filter alongside the existing `trade_executed` / price-batch handlers.

---

## Testing

Frontend tests live under `packages/frontend/tests/` (Vitest). Add:

- `tests/components/achievements/AchievementCard.test.tsx` — renders correct rarity bar/glow/icon for each rarity, locked vs in-progress vs unlocked states, snapshot per state.
- `tests/components/achievements/AchievementToast.test.tsx` — toast appears on store push, dismisses on × click, advances queue, respects `prefers-reduced-motion`.
- `tests/stores/achievementToastStore.test.ts` — enqueue / dismiss / `_advance` logic, FIFO ordering, no duplicate IDs.
- `tests/hooks/useAchievementUnlockStream.test.ts` — own-unlock pushes to store, peer-unlock does not, malformed events ignored.
- `tests/pages/AchievementsPage.test.tsx` — filter chips work (URL search-param sync, multi-rarity, unlocked/locked), sort order, roster derivation, click-through to scoped player view.
- Playwright e2e: trigger a backend unlock end-to-end, assert the toast appears for the unlocking player only, assert the panel updates within 1s.

Shared component snapshot tests in `tests/components/achievements/` should render against both `--bg` dark and `html:not(.dark)` light themes to lock in the rarity-token light-theme variants.

---

## Verification

1. `pnpm --filter shared typecheck` — DTO additions compile.
2. `pnpm --filter server typecheck && pnpm --filter server test` — `defineAchievement` + WS broadcast amendments don't break existing tests; the three committed definitions have valid `rarity` + `icon`.
3. `pnpm --filter frontend typecheck && pnpm --filter frontend test` — all new component + hook + store tests pass.
4. `pnpm --filter frontend lint`.
5. `pnpm --filter frontend dev` — manually:
   - Navigate to `/games/:id/achievements`, confirm grid renders, all 5 rarities show correctly in both light + dark themes, locked cards muted but readable.
   - Trigger a backend unlock (e.g. place first trade), confirm toast appears top-center with two-beat reveal, halo lingers, ring pulses once.
   - Confirm a peer-triggered unlock (use a second browser session) does NOT toast on your screen but DOES appear in the panel after refresh / invalidation.
   - Resize to 600px, confirm grid drops to single column and toast width clamps.
   - Enable `prefers-reduced-motion` in devtools, confirm toast appears instantly with no flare/ring/halo animation.
6. `pnpm --filter frontend e2e` — Playwright unlock flow passes.

---

## Out of scope (deferred to future specs)

- Achievement detail drawer / modal with extended stats (in-game unlock rate, unlock timestamps for all players, etc.).
- Point values / scoring weight from achievements feeding the leaderboard.
- Cross-game / lifetime achievement aggregation.
- Sharing / export ("share my unlock to Discord").
- Sound effects on unlock.
- Animated icons (currently Lucide static SVGs); a future polish pass could give legendaries a one-time icon transform on first unlock-in-history.
