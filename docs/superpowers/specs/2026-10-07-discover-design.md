# Discover — Design Spec

**Date:** 2026-10-07
**Status:** Approved (brainstorming + plan review) — implementing
**Author:** Tristan (with Claude Code)

---

## Context

Players tend to trade the handful of tickers they already know. **Discover** shows each game a daily selection of stocks so its players come across new trade ideas. The selection is shared by everyone in a game and rolls over once a day. List generation must **never hold a user's API call or page load**, so a background worker builds the lists and the endpoint only reads stored rows.

## Glossary

- **Session**: the NYSE regular *trading* session, 09:30–16:00 ET on a trading day. It never means a user's login session on the website.
- **Daily picks**: 20 stocks per game per day, sampled at random from the S&P 500. The sample is seeded by game + date, so each game gets its own picks. No market data is needed to choose them.
- **Market movers**: four themed lists that come from Yahoo's live market data rather than from us:
  - *Top gainers*: the biggest % rise that day (Yahoo screener `day_gainers`)
  - *Top losers*: the biggest % drop (`day_losers`)
  - *Most active*: the highest trading volume (`most_actives`)
  - *Trending*: the most-viewed tickers on Yahoo (`trendingSymbols`)

  Each list has 5 entries. They describe the market as a whole, so every game sees the same lists on a given day. They are fetched once per day and stored once globally, not once per game. Each of these lists is called a "section" in the data model.

## Decisions (from brainstorming)

| # | Decision |
|---|---|
| D1 | **Hybrid content.** The page shows *Daily picks* (20, per game, from the full S&P 500) first, then the four *Market movers* lists (5 each, shared across games). |
| D2 | **Entry points.** A "Discover" link in `AppHeader` on game pages, beside Achievements. An arena right-rail teaser panel with 3 items and a "See all ↗" chip. The page lives at `/games/:gameId/discover`. |
| D3 | **Rollover after market close.** The list key is the date of the **last completed** trading session. A list stays fixed through the next trading day, and weekends and holidays keep the last session's list. |
| D4 | **Background generation only.** An interval worker generates everything. `GET /games/:id/discover` makes no provider calls. It returns the newest stored list, flagged by `sessionDate`, or an empty "being prepared" state. |
| D5 | **No live prices on the page.** Each item stores price and change % from generation time, shown as "as of Mon close". Opening a row uses the existing quote dialog, which fetches live. Discover symbols never join the price poller or the game socket. |
| D6 | **Movers are fetched only between the close and the next open.** Yahoo's screeners always describe the trading day *in progress*. A fetch at 10:00 ET Tuesday would return Tuesday's first-30-minute movers, stored as "Monday's close", which would be wrong. So the worker fetches movers in the window from 16:00 ET until the next 09:30 open, which in practice means the first tick after the close (~16:05). If the server is down for the entire window, that day's movers are skipped and the daily picks still appear. |
| D7 | **Each movers list fails on its own.** A failed Yahoo call doesn't block the other lists, and a missing list is retried on later ticks within the window. A failure is never stored as an empty list. |
| D8 | **Game status.** Pending and active games get lists. Ended games get no new lists: the page shows a "game over" empty state and the teaser is hidden. |
| D9 | **Provider support for movers is optional.** Yahoo and mock implement it. Alpaca omits the method, so only daily picks appear there. |

## Shared types — `packages/shared/src/types/discover.ts` (re-export from `index.ts`)

```ts
type DiscoverSectionKind = 'picks' | 'gainers' | 'losers' | 'active' | 'trending';
interface DiscoverItem { symbol: string; name: string | null; price: number | null;
  changePct: number | null; sector?: string | null }   // values as of generation
interface DiscoverSection { kind: DiscoverSectionKind; items: DiscoverItem[] }
interface DiscoverList { gameId: string; sessionDate: string /* YYYY-MM-DD, NY */;
  generatedAt: string; sections: DiscoverSection[] }  // missing movers lists omitted
type DiscoverResponse = { status: 'ready'; list: DiscoverList } | { status: 'preparing' } | { status: 'ended' };
```

## Server

1. **Calendar.** Add `lastCompletedTradingSession(now)` to `services/market-calendar.ts`. During a session it returns the previous trading day; otherwise it is the same as `mostRecentTradingSession`. Reuse the existing `nyParts`/`isTradingDay` internals. "Session open now" is `mostRecentTradingSession(now).isoDate !== lastCompletedTradingSession(now).isoDate`.
2. **Provider.** In `providers/interface.ts`, add an optional `getMarketMovers?(kind: 'gainers'|'losers'|'active'|'trending', count): Promise<MarketMoverItem[]>`, alongside the optional `getQuotes?`.
   - **Yahoo** (`providers/yahoo.ts`): `client.screener({ scrIds: 'day_gainers' | 'day_losers' | 'most_actives', count })` and `client.trendingSymbols('US', { count })`. Trending returns symbols only, so enrich it with `getQuotes`. Filter to equities. Wrap with `recoverYahooValidationResult` because of schema drift, and route a 429 through the existing backoff.
   - **Mock** (`providers/mock.ts`): deterministic lists.
   - **CachedProvider**: pass through via `upstream()` to get the span and metrics. No cache layer is needed because results are persisted.
3. **S&P 500 universe.** `services/discover/sp500.ts` is a checked-in constant of all ~503 S&P 500 constituents as `{ symbol, name, sector }`, with a header comment giving the as-of date. There is no provider API for index membership, so the list is refreshed by hand when it drifts; record that in `docs/design.md` under Known Gaps. Normalize symbols to Yahoo form (`BRK.B` becomes `BRK-B`). `services/discover/picks.ts` hashes `gameId:sessionDate` into a seeded PRNG (mulberry32) and samples 20 symbols without replacement. The function is pure and deterministic.
4. **Schema.** Add both tables to both `schema.sqlite.ts` and `schema.pg.ts`, with a table comment each. JSON payload is stored as `text` in SQLite (like `system_settings.value`) and as `jsonb` in Postgres.
   - `discover_market_movers`: `(sessionDate, kind)` unique, `items`, `fetchedAt`. Global, one row per movers list per day.
   - `game_discover_picks`: `gameId` FK with `onDelete: cascade`, `(gameId, sessionDate)` unique, `items`, `generatedAt`.
   - Generate migrations with `pnpm --filter server db:generate` for both dialects. Never hand-edit them.
5. **Service.** `services/discover.ts`:
   - `refreshMarketMovers(db, provider, now)` returns early while a session is open (D6). Otherwise it fetches each movers list still missing for the key, each in its own try/catch (D7), and inserts with `onConflictDoNothing`.
   - `refreshGamePicks(db, provider, now)` runs at any time of day, because picks don't depend on intraday data. For pending/active games with no row for the key, it samples 20, makes one `getQuotes` batch across all those games' picks (heavily overlapping, chunked at 50 by CachedProvider), then inserts. Errors are caught per game, as in `recordSnapshotsForActiveGames`. If a quote is missing, the item is stored with `price: null`.
   - `pruneDiscover(db, keepDays = 14)`.
   - `getDiscoverForGame(db, gameId)` is a pure read: the newest picks row plus the movers lists for the same `sessionDate`.
6. **Worker.** `workers/discover.ts`: `runDiscoverTick(deps)` runs movers, then picks, then prune. `startDiscoverWorker` uses `startIntervalWorker`. Add `DISCOVER_REFRESH_INTERVAL_MS` (default 300000) in `env.ts` and `.env.example`; it has a default, so no deployment change is needed. Wire it in `app.ts` inside `if (!disablePoller)` and stop it in `onClose`, like the snapshot worker (`app.ts:191`). A new game shows "preparing" for at most one tick (≤5 min).
7. **Route.** `routes/discover.ts`: `GET /games/:id/discover` with `onRequest: authenticate`, Zod params, and the inline 404-for-non-members check copied from `routes/games.ts:411-421`. It returns `DiscoverResponse` and touches only the DB. Register it in `app.ts:139-156`. Add JSDoc on the exported functions.

## Frontend

- **API:** `api/discover.ts` provides `useDiscover(gameId)`, using React Query and `apiFetch`, with a long `staleTime` and a refetch every 5 min while the response is `preparing`.
- **Route:** add a lazy `DiscoverPage` at `/games/:gameId/discover` next to `App.tsx:145-146`.
- **Header link:** add a `Discover` NavLink in `AppHeader.tsx` beside Achievements. The comment at `:32-35` warns the row already overflows at 375px, so below `sm` the two game links become icons (`Trophy`, `Compass`) with `aria-label`s. Check this at 375px.
- **Page** (`pages/DiscoverPage.tsx` + `components/discover/`):
  - Reuse the `Crumb` breadcrumb from `GameLeaderboardPage.tsx:112-129`.
  - Show an "as of <session date> close" stamp.
  - Daily picks (20) are the main block, possibly grouped or filterable by sector, which the design pass decides. The four movers lists sit beside or below them.
  - Each row shows symbol, name, price and change %, plus sector for picks.
  - Clicking a row goes through `SymbolButton`/`openQuote`. The page mounts `QuoteInfoDialog` and `TradeOrderDialog` itself, as `GameDetailPage.tsx:362-395` does, because the arena's copies reset when it unmounts. It passes the game's `allow*` flags from `useGame`.
  - States: loading, preparing, ended, and error.
  - **Use the `frontend-design` skill here**, as you asked. It works within the existing tokens and Geist type: Panel primitives, `text-gain`/`text-loss`, and the mono label style.
- **Arena teaser:** `components/game/arena/DiscoverPanel.tsx` in the right rail, between `SymbolSearchPanel` and `WatchlistPanel` (`GameDetailPage.tsx:350-360`). It shows 3 items: the first daily pick, the top gainer and the top most-active, filled from picks when movers are missing. The "See all ↗" chip reuses the `FullViewLink` style (`LeaderboardPanel.tsx:207-216`). Rows call `setSelectedSymbol`, like the holdings rows. On mobile it sits in the right-rail stack after search. It is hidden for ended games.

## Edge cases

- **Game created mid-day:** it shows "preparing" until the next tick, then gets picks keyed on the last completed session. Movers appear if they were fetched after the previous close.
- **Server down for the whole after-close window:** that day's movers are skipped and picks still generate.
- **S&P constituent delisted or renamed:** the quote is missing, so the item is stored with `price: null` and the UI shows "—". The fix is a manual refresh of `sp500.ts`.
- **Stored `status` lags dates:** the worker filters on the stored `status` column, the same way the snapshot worker does. A game whose status flips late gets its list on a later tick.

## Testing (TDD)

- **Server:**
  - `tests/services/market-calendar.test.ts`: `lastCompletedTradingSession` mid-session, after 16:00, weekend, and holiday.
  - `tests/services/discover-picks.test.ts`:
    - determinism
    - exactly 20 with no duplicates
    - different seeds per game and day
    - every symbol drawn from `sp500.ts`
  - `tests/services/discover.test.ts`, using `createTestDb()` and the mock provider:
    - movers skipped mid-session and fetched after close
    - a failed movers list retried on the next tick
    - picks generated mid-session
    - idempotent inserts
    - ended games skipped
    - prune
  - `tests/workers/discover.test.ts`: tick plus fake timers, as in `portfolio-snapshot.test.ts`.
  - `tests/routes/discover.test.ts`:
    - 404 for a non-member
    - `preparing`, then `ready` after a tick
    - `ended`
    - a provider spy asserting the route makes zero provider calls
  - Provider tests for the yahoo and mock `getMarketMovers`.
- **Frontend:** component tests for `DiscoverPage` states and `DiscoverPanel`. Extend the Playwright e2e to open Discover from the header, then a row, then the trade dialog.

## Execution order

1. `git checkout -b feat/discover`.
2. Save this design as `docs/superpowers/specs/2026-10-07-discover-design.md` and commit it. This replaces the brainstorming skill's separate spec-review stage; approving this plan counts as approving the spec.
3. Server, test-first: calendar → S&P universe/picks → provider → schema + migrations → service → worker → route.
4. Shared types, then frontend API, route, and header link. Then **invoke `frontend-design`** for the Discover page and the teaser.
5. Docs: a `### Discover` subsection in `docs/design.md` (Watchlist-notes style, plus a Known Gaps entry for the hand-maintained S&P list), the new env var in `.env.example` and CLAUDE.md's env list, a `docs/observability.md` note for the worker span, and `pnpm changeset` (minor).

## Verification

- Run `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm --filter frontend e2e`.
- Manual run: `STOCK_PROVIDER=mock pnpm dev`. Create a game, see "preparing", wait for one tick (or set a short `DISCOVER_REFRESH_INTERVAL_MS`), see the 20 picks plus movers on `/games/:id/discover` and the teaser in the arena, and open a row through to the trade dialog. Check 375px and both themes.
- Repeat once with `STOCK_PROVIDER=yahoo` outside market hours to confirm real screener data.

## Out of scope

- Live-ticking Discover prices.
- Game-social signals (what rivals are buying).
- Admin controls over the universe.
- Alpaca movers.
- Per-user personalisation and "add to watchlist" from Discover.
