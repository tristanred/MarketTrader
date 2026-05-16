# MarketTrader Design Refresh — "Modern Terminal"

**Status:** Approved design, ready for implementation planning
**Date:** 2026-05-15
**Scope:** Full player-facing visual refresh + server support for the new chrome (status strip, ticker tape). Admin pages inherit theme tokens but keep their current layout.

---

## 1. Goal

The current frontend is functional but visually generic — a stock ShadCN/UI default look (slate palette, system sans, card-stacked layouts). Replace it with an opinionated **modern terminal** aesthetic: dense, data-rich, dark-by-default, with mono numbers and an ice-blue accent. Make MarketTrader feel like a piece of trading software a small group of competitive friends actually want to be in.

This is a UI/UX refresh — business rules, API contracts, and storage are unchanged except for the additions explicitly listed below (`system_settings` table, indices WS channel, ticker-tape admin route).

---

## 2. Design language

### Typography
- **Geist** (sans, weights 400/500/600/700) for all labels, prose, and player names.
- **Geist Mono** for all numbers, ticker symbols, timestamps, and uppercase mono labels (`OPEN`, `LIVE`, panel headers).
- Tabular numerics (`font-feature-settings: 'tnum' 1, 'zero' 1`) on by default for mono runs.
- Self-hosted via `@fontsource/geist-sans` and `@fontsource/geist-mono` packages — no runtime dependency on Google Fonts.

### Color tokens

Both themes share the same semantic token names; the values change per theme.

**Dark theme (default)**
| Token | Value | Use |
|---|---|---|
| `--bg` | `#0a0b0d` | App background |
| `--panel` | `#0c0d10` | Panel surface |
| `--hairline` | `#161719` | Internal panel dividers |
| `--hairline-strong` | `#1d1f23` | Panel outer borders, section separators |
| `--text` | `#e8e9ea` | Body text |
| `--text-strong` | `#f4f4f5` | Player names, headings |
| `--muted` | `#6b7280` | Secondary text, labels |
| `--accent` | `#67e8f9` | Brand, focus rings, active states, ticker chips, LIVE pill, current-user marker |
| `--accent-bg` | `rgba(103,232,249,0.10)` | Accent backgrounds (pills, active rows) |
| `--gain` | `#10b981` | Positive P&L only |
| `--loss` | `#ef4444` | Negative P&L only |

**Light theme — "Paper"** (active when `<html>` does **not** have the `.dark` class; the dark theme is keyed on `.dark`)
| Token | Value | Use |
|---|---|---|
| `--bg` | `#f7f5f0` | App background (warm off-white) |
| `--panel` | `#ffffff` | Panel surface |
| `--hairline` | `#ebe7dd` | Internal dividers |
| `--hairline-strong` | `#e0dcd2` | Outer borders |
| `--text` | `#1a1a1a` | Body text |
| `--text-strong` | `#0a0908` | Player names, numbers, headings |
| `--muted` | `#6b665c` | Secondary text, labels |
| `--accent` | `#0891b2` | Same role as dark, darker shade for AA contrast |
| `--accent-bg` | `rgba(8,145,178,0.08)` | Accent backgrounds |
| `--gain` | `#047857` | Positive P&L |
| `--loss` | `#b91c1c` | Negative P&L |

Theme defaults to dark. User toggles via the existing header button; selection persisted in `themeStore` (already wired).

**P&L color rule (both themes):** gain/loss colors are reserved for numbers and arrows. They never appear on backgrounds, borders, or non-monetary text. The accent color never represents money.

### Geometry & elevation
- Panel radius: 6px. Chip/button radius: 4px.
- Borders: 1px hairlines. No box shadows anywhere — depth comes from contrast, not blur.
- Spacing scale: 4 / 8 / 14 / 18 / 24 / 32px (matches existing Tailwind defaults).

### Motion
- Ticker tape: continuous left-to-right CSS marquee, ~40s per loop.
- Market-open dot: 1.6s pulse (opacity 0.5 → 1 → 0.5).
- Trade execution feedback: flash row background with `--accent-bg` for 600ms.
- All motion respects `@media (prefers-reduced-motion: reduce)`: tape becomes statically horizontally-scrollable; dot becomes solid; trade flash is omitted.

---

## 3. Global shell

Three rows of chrome, persistent across every authenticated page.

### 3.1 Topbar (44px)
- **Left:** brand mark (accent dot + "MarketTrader" wordmark, Geist 700 -0.02em tracking) · primary nav: `Games`, `Markets`, `Activity`, and `Admin` (only visible to admin role).
- **Right:** username (muted) · theme toggle (sun/moon) · `Sign out` button.

Active nav item: text `--text-strong` on `--hairline` chip background, no underline.

### 3.2 Status strip (28px, below topbar)
- **Left cluster:** pulse dot + `MARKET OPEN` / `MARKET CLOSED` (mono uppercase) · ticking ET clock (HH:MM:SS, updates every second) · `LIVE` pill · `^GSPC` / `^IXIC` / `^DJI` symbol + last + day %. Tooltip on each index shows full name.
- **Right cluster (game-context only):** `DAY n / N · <Game Name>` followed by a small `[i]` info button that opens a modal with the game's settings/rules (absorbs the current `AboutThisGameCard`).
- Background: slightly darker than `--bg` (use `color-mix(--bg, black 4%)` or hard-coded `#07090a` / `#f0ede5`).

### 3.3 Ticker tape (24px, sticky at viewport bottom)
- Scrolling left-to-right marquee.
- Content: server-configured symbol list, indices first, then major stocks. Each entry: `<SYM> <last> <±%>`.
- Pauses on hover; each symbol is clickable → navigates to `/symbols/:symbol` if outside a game, or selects the symbol in `SelectedSymbolContext` if inside a game.
- Reduced-motion fallback: tape becomes a static, horizontally-scrollable row.
- Source: `useIndicesSocket()` (see §6.4) — subscribed once at `AppShell` mount, fed by a global `indicesBroadcaster` on the server.

---

## 4. Pages

### 4.1 Games list (`/`)
- Page header row: `Your games` (Geist 700, 22px) + `+ NEW GAME` action (accent outline button, mono caps).
- Each game = **one row card** (replacing the current stacked card). Layout: `name + meta` (left, flex 1) · `Rank` · `Portfolio` · `P&L%` · `Day n/N` · chevron.
- Hover: hairline border lightens; whole row links to `/games/:id`.
- Empty state: mono-styled text "No games yet — create one to get started" centered in a panel-chromed container.

### 4.2 Game detail (`/games/:gameId`) — the "Arena"

Three-column CSS grid below the chrome, fills the viewport:

```
┌─ Left (280px) ───┬─ Center (flex) ──────┬─ Right (300px) ─┐
│ Leaderboard      │ Quote header         │ Symbol search   │
│ Portfolio        │ Chart                │ Watchlist       │
│                  │ OHLC + Buy/Sell      │ Activity        │
│                  │ Holdings             │                 │
└──────────────────┴──────────────────────┴─────────────────┘
```

**Shared panel chrome:** 1px `--hairline-strong` border, 6px radius, header bar (28px tall, mono uppercase 10px tracking-wide label left, optional action/LIVE indicator right), body padding 8/10.

**Left column — `LeaderboardPanel` (flex-fills)**
- Columns: rank · player · value · P&L%.
- Current user's row pinned visually with a 2px `--accent` left border and `--accent-bg` row tint.
- Click any row opens that player's portfolio in a modal (existing flow).
- Updates via existing leaderboard WS message.

**Left column — `PortfolioPanel`**
- 2×2 stat grid: Value · P&L% · Cash · Day.
- Mono 14px semibold numbers, mono 9px uppercase labels.

**Center column — `QuoteHeader`** (sticky)
- Layout: `[SYM big mono] · [LAST price big mono] · [Δabs Δ%] · [BUY] [SELL]`.
- BUY: solid accent button, `--bg`-colored text. SELL: outlined loss-color button.
- Both buttons open the existing `TradeOrderDialog` pre-filled with the selected symbol.
- Reads selected symbol from `SelectedSymbolContext` (see §6.3).

**Center column — `ChartPanel`**
- Wraps existing `StockChart` (TradingView Lightweight Charts) in the new panel chrome.
- Restyled: charcoal/paper background per theme, accent line, gain/loss volume bars, mono crosshair labels.
- Time-range pills below chart: `1D 5D 1M 3M 1Y`.

**Center column — OHLC strip** (sits between chart and holdings)
- Mono small caps: `O <open>   H <high>   L <low>   V <volume>`.

**Center column — `HoldingsPanel`**
- Replaces existing `PortfolioTable`.
- Columns: symbol · name · qty · avg cost · market value · P&L%.
- Clicking a row sets the symbol in `SelectedSymbolContext` (quote header + chart + OHLC update in place — no navigation).
- Symbol chip styling: accent-colored mono, 1px outline on hover.

**Right column — `SymbolSearchPanel`** (pinned top of right column)
- Slim search input with placeholder `▸ Search symbol...` and a `⌘K` hint chip on the right.
- Click input or hit `⌘K`/`Ctrl+K` → opens a centered overlay dialog with the same typeahead.
- Result click: sets the symbol in `SelectedSymbolContext` (in-game) or navigates to `/symbols/:symbol` (out-of-game).
- Replaces the deleted `SymbolSearchCard` (same data fetching logic, restyled).

**Right column — `WatchlistPanel`**
- List of `[symbol-chip] [last] [day %]` rows.
- "+ ADD" action top-right opens the same `SymbolSearch` typeahead, scoped to add-to-list.
- Click row → sets symbol in `SelectedSymbolContext`.

**Right column — `ActivityPanel`** (flex-fills)
- Terminal-style scrolling feed of recent trades in the game.
- Each row: `HH:MM · <player> BUY|SELL N SYM @ price`. Player names in accent color, `BUY` in gain green, `SELL` in loss red.
- Pulls from existing trade-activity WS message; newest at top.

**Removed components** (logic absorbed into the new layout):
- `YourProfileCard` → replaced by `PortfolioPanel`.
- `AboutThisGameCard` → moves to a modal opened from the `[i]` button in the status strip's right cluster.
- `SymbolSearchCard` → replaced by `SymbolSearchPanel` + `cmd+k` overlay.

**Interaction model**
- `SelectedSymbolContext` holds the currently-selected symbol for the center column.
- Every clickable symbol chip anywhere in the page (leaderboard player's top holding, watchlist, holdings, ticker tape, activity feed, search results) updates this context.
- No page navigation happens inside a game — the user stays on `/games/:gameId` and the center column is the canvas.

**Responsive breakpoints**
- `≥1280px`: full three-column grid.
- `900–1279px`: right column collapses into a tab strip atop the center column (`Watchlist` / `Activity` / `Search`).
- `<900px`: both side columns collapse into a single tab strip with `Leaderboard` / `Portfolio` / `Watchlist` / `Activity` / `Search`. Center column always remains the dominant pane.

### 4.3 Login / Register
- Full-viewport split layout: left 60% atmosphere panel, right 40% form panel.
- **Atmosphere panel:** full-bleed `--bg` with a faux leaderboard and faux ticker tape rendered at 25% opacity, animating slowly. Decorative only — no real data, no interactivity. Generates immediate brand impression on first visit.
- **Form panel:** docked to the right, panel chrome, brand mark top-left.
  - Form fields: Geist labels, Geist Mono inputs (username and password feel terminal-native).
  - Focus ring: 1px accent outline + 2px offset.
  - Submit button: solid accent, `--bg`-colored text, mono caps "SIGN IN".
- Status strip is hidden on auth pages (no game context, market clock only shows in the top-right corner of the form panel as a small mono timestamp).

### 4.4 Symbol page (`/symbols/:symbol`)
- Restyled to panel chrome, reuses `QuoteHeader` and `ChartPanel`.
- Used outside of game context (clicked from `Markets` nav, or from the ticker tape when not in a game).

### 4.5 Admin pages
- Theme tokens flow through automatically (existing admin pages already use ShadCN primitives that read from CSS vars).
- No layout work on existing admin pages.
- **New admin page: `Admin → Ticker Tape`** (see §5.2).

---

## 5. Server changes

### 5.1 `system_settings` table

New Drizzle table in both `schema.sqlite.ts` and `schema.pg.ts`:

| Column | Type | Notes |
|---|---|---|
| `key` | TEXT primary key | e.g. `ticker_tape_symbols` |
| `value` | TEXT (SQLite) / JSONB (Postgres) | JSON-encoded |
| `updated_at` | TIMESTAMP | |
| `updated_by` | TEXT | user id; nullable for seed |

Drizzle migration generated via `pnpm --filter server db:generate`. Seed on first boot: insert `ticker_tape_symbols` with default `["^GSPC","^IXIC","^DJI","AAPL","MSFT","NVDA","TSLA","AMZN","META","GOOGL"]`.

### 5.2 Routes

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/system-settings/ticker-tape` | any authed user | Returns `{ symbols: string[], updatedAt: string }` |
| `PUT` | `/admin/system-settings/ticker-tape` | admin only | Body `{ symbols: string[] }`. Validates each symbol via `StockProvider.quote()`; rejects payload entirely if any symbol fails to resolve. Writes audit-log row. Triggers `tickerTapeBroadcaster.reload()`. |

### 5.3 `SystemSettingsService`

New service in `packages/server/src/services/`:
- `getTickerTapeSymbols(): Promise<string[]>` — cached in-memory, invalidated on write.
- `setTickerTapeSymbols(symbols: string[], actorId: string): Promise<void>` — validates + writes + audits + emits change event.
- Emits a Node `EventEmitter` `'ticker-tape-changed'` event consumed by the broadcaster.

### 5.4 `indicesBroadcaster`

New WS broadcaster (one global instance, not per-game):
- Subscribed symbols = `["^GSPC","^IXIC","^DJI"]` ∪ current ticker-tape symbols (de-duped).
- Fetches quotes via existing `StockProvider` interface.
- Batches and broadcasts every 5s on a new WS channel.
- Re-subscribes when `'ticker-tape-changed'` fires.
- Broadcast message shape: `{ type: 'indices', quotes: IndexQuote[], at: string }`.

`StockProvider` extension: ensure Yahoo allows `^`-prefixed index symbols (it does). Alpaca fallback: index symbols not supported → broadcaster catches the error, emits `{ type: 'indices', quotes: [], at, unavailable: true }`, and the frontend renders "INDICES UNAVAILABLE" in the status strip. Documented behavior, not a bug.

### 5.5 WebSocket route

Two ways to handle the new global channel:
- **Option (chosen):** open a single global socket at `/ws/live` that any authed client can connect to for indices + ticker-tape quotes, separate from the per-game `/games/:id/live` socket. Auth via `?token=` query param, same JWT validation as existing socket. The path is distinct from `/games/:id/live` (game-scoped) and from any future namespaced sockets — `/ws/live` is exclusively for app-wide chrome data (indices, ticker-tape config). This avoids coupling chrome data to game membership.

### 5.6 Audit log

`SystemSettingsService.setTickerTapeSymbols` writes one row to `audit_log` per change: action `system_settings.ticker_tape.update`, target `ticker_tape_symbols`, before/after JSON. Reuses existing audit-log infra.

---

## 6. Frontend changes

### 6.1 Theme + tokens
- Replace `packages/frontend/src/index.css` palette section with the two-theme CSS-variable system (§2). Hex values, not HSL.
- Update `tailwind.config.ts`:
  - `colors.accent`, `colors.gain`, `colors.loss`, `colors.panel`, `colors.hairline`, `colors.muted`, `colors.text`, `colors.bg` all reference vars.
  - `fontFamily.sans = ['Geist Sans', 'system-ui', 'sans-serif']`, `fontFamily.mono = ['Geist Mono', 'ui-monospace', 'monospace']`. Note: `@fontsource/geist-sans` registers the typeface as `'Geist Sans'` (with a space), not `'Geist'` — naming it `'Geist'` silently falls through to `system-ui`.
  - `borderRadius.panel: '6px'`, `borderRadius.chip: '4px'`.
  - `keyframes.marquee: { from: { transform: 'translateX(0)' }, to: { transform: 'translateX(-50%)' } }` + `animation.marquee: 'marquee 40s linear infinite'`.
- Add `@fontsource/geist-sans` and `@fontsource/geist-mono` to `packages/frontend/package.json`. Import weights 400/500/600/700 from each in `main.tsx`.

### 6.2 New shared types

In `packages/shared/src/types/`:

```ts
export interface IndexQuote {
  symbol: string;        // e.g. "^GSPC", "AAPL"
  last: number;
  changeAbs: number;
  changePct: number;
  name?: string;         // optional full name, used in tooltips
}

export interface TickerTapeSettings {
  symbols: string[];
  updatedAt: string;     // ISO
}

export type LiveWsMessage =
  | { type: 'indices'; quotes: IndexQuote[]; at: string; unavailable?: boolean }
  | { type: 'ticker-tape-config-changed'; symbols: string[]; at: string };
```

(`LiveWsMessage` is the new shared type for messages on the global `/live` socket; per-game socket messages are unchanged.)

### 6.3 New components

In `packages/frontend/src/components/`:

| File | Purpose |
|---|---|
| `shell/AppShell.tsx` (rewritten) | Stacks `AppHeader` + `StatusStrip` + `<Outlet>` + `TickerTape`, mounts `useIndicesSocket()` |
| `shell/AppHeader.tsx` (rewritten) | Topbar: brand + nav + theme toggle + user + sign out |
| `shell/StatusStrip.tsx` | Pulse dot + clock + LIVE pill + index quotes + game-context cluster |
| `shell/TickerTape.tsx` | Marquee with reduced-motion fallback |
| `shell/AboutGameModal.tsx` | Pops from the `[i]` button in the status strip |
| `panel/Panel.tsx`, `panel/PanelHeader.tsx`, `panel/PanelBody.tsx` | Shared panel chrome primitive |
| `game/arena/SelectedSymbolContext.tsx` | React context for the in-arena selected symbol |
| `game/arena/LeaderboardPanel.tsx` | Left col top |
| `game/arena/PortfolioPanel.tsx` | Left col bottom |
| `game/arena/QuoteHeader.tsx` | Center col top |
| `game/arena/ChartPanel.tsx` | Center col middle |
| `game/arena/HoldingsPanel.tsx` | Center col bottom |
| `game/arena/WatchlistPanel.tsx` | Right col middle |
| `game/arena/ActivityPanel.tsx` | Right col bottom |
| `search/SymbolSearch.tsx` | Single component with `mode: 'pinned' \| 'overlay'` |
| `search/SymbolSearchPanel.tsx` | Pinned wrapper for right col |
| `search/SymbolSearchOverlay.tsx` | `cmd+k` modal wrapper |
| `search/useCommandK.ts` | Hook that wires `cmd+k` / `ctrl+k` to open the overlay |
| `admin/TickerTapeEditor.tsx` | Add/remove rows + Save |

### 6.4 Hooks

- New `useIndicesSocket()` — connects to `/live`, auth via JWT, dispatches `indices` and `ticker-tape-config-changed` messages into React Query caches keyed `['indices']` and `['ticker-tape-symbols']`. Mounted once at `AppShell`.
- Existing `useGameSocket(gameId, symbols)` — unchanged.
- `useTickerTapeSymbols()` — wraps the React Query cache fed by both initial `GET /system-settings/ticker-tape` and live `ticker-tape-config-changed` messages.
- `useSelectedSymbol()` / `useSetSelectedSymbol()` — consumers of `SelectedSymbolContext`.

### 6.5 Rewritten pages

- `pages/GameDetailPage.tsx` — replaces the current 2/3-column card stack with the three-pane grid (see §4.2). Existing API hooks (`useGame`, `usePortfolio`, etc.) and WS subscription logic are retained verbatim — the rewrite is composition, not data flow.
- `pages/GamesListPage.tsx` — row-card list (see §4.1).
- `pages/LoginPage.tsx`, `pages/RegisterPage.tsx` — split layout with atmosphere panel.
- `pages/SymbolPage.tsx` — restyled to panel chrome; uses `QuoteHeader` and `ChartPanel`.

### 6.6 Deleted files
- `components/SymbolSearchCard.tsx`
- `components/game/YourProfileCard.tsx`
- `components/game/AboutThisGameCard.tsx`

Their logic is absorbed as documented.

---

## 7. Build sequence (phases / PRs)

Each phase is independent and lands as a separate PR.

1. **Foundation** — theme tokens, fonts, Tailwind extensions, `Panel` primitive. No visible UX change beyond the palette flip on existing components.
2. **Global chrome** — `AppHeader`, `StatusStrip`, `TickerTape`, `system_settings` table + migration, `GET /system-settings/ticker-tape` route, `indicesBroadcaster`, `useIndicesSocket`. Tape uses live data; admin editor not yet built (default seed values are visible).
3. **Arena rewrite** — `GameDetailPage` rebuilt with the seven panels + `SelectedSymbolContext`. Biggest single PR.
4. **Search consolidation** — `SymbolSearch` component with pinned + overlay modes, `cmd+k` hook, removal of `SymbolSearchCard`.
5. **Admin ticker-tape editor** — `PUT /admin/system-settings/ticker-tape` route + audit + `TickerTapeEditor.tsx`. Verifies live rebroadcast end-to-end.
6. **Games list + auth pages** — row cards on games list, split-layout auth pages. Lowest risk; last because they're not on the critical interaction path.

---

## 8. Testing strategy

### Server (Vitest)
- `SystemSettingsService`: default seed on first boot, validation rejects unknown symbols, audit row written on update, in-memory cache invalidates after write.
- `PUT /admin/system-settings/ticker-tape`: admin-only auth guard, payload schema, broadcaster reload fires.
- `GET /system-settings/ticker-tape`: any authed user, returns current.
- `indicesBroadcaster`: fake-clock test asserts 5s batched emission cadence; reload event causes subscription refresh; Alpaca-unavailable path emits `unavailable: true` and doesn't throw.

### Frontend (Vitest + React Testing Library)
- `SelectedSymbolContext`: writes propagate to `QuoteHeader` / `ChartPanel` / `OHLC` consumers.
- `TickerTape`: renders configured symbols, marquee starts, pauses on hover, no animation under `prefers-reduced-motion`.
- `LeaderboardPanel`: current user's row is marked with the accent left border.
- `StatusStrip`: ticks the clock once per second; reflects index-quote updates; shows `INDICES UNAVAILABLE` on `unavailable: true` payload.
- `SymbolSearch`: opens on `cmd+k`, closes on Esc, result click writes to context (in-game) or navigates (out-of-game).
- Theme switching: removing the `.dark` class from `<html>` flips all tokens to the Paper light theme; adding it flips back to dark. No component remount required (snapshot of rendered styles before/after).

### Playwright e2e
- New spec: sign in → open a game → click a holdings row → assert `QuoteHeader` symbol updates without navigation.
- New spec: sign in as admin → open ticker-tape editor → add a symbol → in a parallel non-admin session, assert the tape shows the new symbol without page reload (validates the WS rebroadcast).
- Existing e2e specs updated to find new component selectors.

### Visual snapshots
- Playwright takes one full-page screenshot per page (games list, game detail, login, admin ticker tape) per theme. Stored in `tests/__screenshots__/` as a manual reference; not enforced in CI for v1.

---

## 9. Open questions

(Carry into implementation planning, not into this design.)

- **Charts library theming.** TradingView Lightweight Charts accepts colors via JS options. We'll need a small `useChartTheme()` hook that recomputes options from CSS vars on theme change. Confirm whether the existing `StockChart` already exposes a config seam, or whether it needs a small refactor in phase 1.
- **Atmosphere panel data source.** Faux leaderboard on login: hard-coded canned data, or a low-rate poll of a public demo game? Recommend canned — first impression should be fast and offline-capable.
- **Admin role gating.** The `Admin → Ticker Tape` route assumes the existing admin role check already in place for other admin routes (`AdminRoute` in `App.tsx`). Confirm no new role/permission needed.

---

## 10. Out of scope (explicitly)

- Restyling admin page layouts (they pick up tokens automatically).
- New trading features (no order types added; no fractional shares; no shorts).
- Internationalization or RTL layouts.
- Mobile-native app — responsive web only.
- Persisting user preference for "compact / comfortable" density — v1 ships at one density.
