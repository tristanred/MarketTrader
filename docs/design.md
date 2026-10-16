# MarketTrader — Evolving Design Document

This document describes the current design intent for MarketTrader. It is updated as features are designed or changed. For the full initial spec, see `docs/superpowers/specs/2026-05-08-markettrader-design.md`. For the rationale behind technology choices, see `docs/technical-decisions.md`.

---

## Product Vision

MarketTrader lets groups of friends run virtual stock trading tournaments. Players join a time-bounded "game", start with the same virtual cash, and compete to build the most valuable portfolio by trading real stocks at real market prices. A live leaderboard tracks rankings throughout the game.

Target audience: small friend groups (2–20 players), casual investors, people learning markets in a low-stakes way.

---

## Core User Flows

### 1. Register and log in
User picks a username and password. JWT token returned. No email required (MVP).

### 2. Create a game
- Set a name, start date, end date, and starting balance (e.g. $100,000)
- Game status: `pending` until start date, `active` during the trading window, `ended` after end date
- Choose public (listed for everyone) or private (invite-only); public is the default
- Share the invite link from the game info modal

### 3. Join a game
- Public games are listed for every signed-in user under "Open games" and can be joined with one click
- Public games can also be joined directly by raw ID; private games require the current invite code (validated server-side on join, not just at lookup) — a public listing seen before the game went private does not grant access
- Balance starts fresh even if the game has been running
- Joining is rejected once the game has ended

### 4. Trade
- Search for a stock ticker (e.g. "AAPL")
- Enter quantity, choose Buy or Sell
- Server fetches current price, validates (enough cash to buy, enough shares to sell), executes immediately
- Balance and portfolio updated atomically

### 5. Monitor portfolio
- View current holdings with unrealized P&L
- View trade history
- See leaderboard ranking in real-time

### 6. Game ends
- Status flips to `ended` at `endDate`
- Final leaderboard snapshot is preserved
- No more trades accepted

---

## Entities (current version: MVP)

See the spec for full schema. Summary:

| Entity | Purpose |
|---|---|
| `User` | Account (username + password) |
| `Game` | A tournament with rules (dates, starting balance, discoverability) |
| `GamePlayer` | A user's participation in a game + their cash balance |
| `Portfolio` | Current stock holdings per player per game |
| `Trade` | Immutable log of every buy/sell executed |
| `StockPriceCache` | Short-lived cache of fetched stock prices |
| `Watchlist` / `WatchlistItem` | User-owned symbol lists, global to the user rather than scoped to a game |
| `DiscoverMarketMovers` | One market-wide Discover list (gainers, losers, most active, trending) per NYSE session, shared by every game |
| `GameDiscoverPicks` | A game's 20 Discover daily picks for one NYSE session |

`Game` carries two discoverability fields:

- `visibility` — `public` | `private`. Public games appear in `GET /games/browse`. Defaults to `public`; games created before this field existed were adopted as public.
- `inviteCode` — short share token behind `/join/:code`. Nullable: pre-existing games mint one on first share. Only ever returned to members; `GET /games/browse` omits it.

### Watchlist symbol notes

Each `WatchlistItem` carries a nullable `note` — the user's free-form memo for
that symbol, written from a floating editor beside the ticker in the arena's
watchlist panel.

- `PATCH /watchlists/:id/items/:symbol` sets it; a blank or whitespace-only body
  clears it, so there is no separate delete verb. A symbol that is not on the
  list answers 404 rather than creating one.
- Capped at 1000 characters by the route's Zod schema, deliberately *not* by a
  `WATCHLIST_MAX_*` env var — those exist to bound the price poller's per-tick
  symbol set, and a note adds no symbols.
- `Watchlist.notes` in `packages/shared` is a sparse `Record<string, string>`
  and is omitted entirely when no symbol on the list carries one, so the common
  case costs nothing on `GET /watchlists`.
- Notes die with their row: removing a symbol from the list drops its note, and
  re-adding the symbol starts blank.
- The editor autosaves — 700 ms after typing stops, and again on close. There
  is no save control, so closing or dismissing never discards an edit. A write
  that fails on close has no status strip left to report into, so it raises a
  toast and keeps the unsaved text in the box; reopening the note restores that
  text and the debounce retries on its own.
- It resizes from any of its four corners, each holding the opposite edges
  still. The right-hand rail leaves no room to grow eastward, so the west
  corners are the ones that matter; the east ones stop at the viewport margin
  rather than sliding the note out from under the cursor.
- Corner drags move the note through Radix's `alignOffset`/`sideOffset` rather
  than a CSS transform. A transform would move it without Radix knowing, and its
  collision handling would measure the stale position and shove the note back
  mid-drag.
- Its dragged size is remembered across every note in `localStorage`
  (`mt:note-size`), clamped to the viewport on read so a size stored on a wide
  monitor cannot open off-screen on a phone. Where it was dragged *to* is not
  remembered — each note re-anchors to its own row.

### Discover

A per-game page (`/games/:gameId/discover`) of stocks to consider trading, so
players look past the handful of tickers they already know. Reached from a
Discover link in the top nav on game pages and from a three-row teaser panel in
the arena's right rail. Full design: `docs/superpowers/specs/2026-10-07-discover-design.md`.

- Two kinds of content. **Daily picks** are 20 S&P 500 constituents sampled per
  game per session, seeded by `gameId:sessionDate` so each game gets its own
  draw (`services/discover/picks.ts`). **Market movers** are four lists of 5
  (top gainers, top losers, most active, trending) from the provider's optional
  `getMarketMovers`; they describe the whole market, so they are stored once per
  session and shared by every game. Alpaca has no implementation, so its games
  show daily picks only.
- A list is keyed on the **last completed** NYSE session
  (`lastCompletedTradingSession`), so it rolls over after the 16:00 ET close and
  holds through the next trading day, weekends and holidays included.
- Only the Discover worker (`workers/discover.ts`, every
  `DISCOVER_REFRESH_INTERVAL_MS`, first tick at boot) produces lists.
  `GET /games/:id/discover` reads stored rows and never calls the provider; it
  answers `preparing` until the worker has run for a new game, and `ended` once
  the game is over (404 for non-members, like every game route).
- Movers are fetched only while no regular session is open: Yahoo's screeners
  describe the day in progress, which would otherwise be stored as the previous
  close. Each list is fetched on its own, and a failed or empty one leaves no
  row, so a later tick retries it rather than locking in a gap for the day.
- Prices are a snapshot taken at generation, not live — the page says when. If
  the batch quote fails outright (a cold cache under a 429), picks are stored
  without prices so the page still works, and later ticks re-quote that row in
  place. A row with only *some* prices missing is left alone: that is usually a
  delisted symbol, which no retry fixes.
  Discover symbols never join the price poller or the game socket, so the
  feature adds nothing to the poller's per-tick symbol set.
- Rows older than 14 sessions' worth of days are pruned by the same worker.

### Runtime configuration (admin)

`/admin/config` lists every option the server reads from its environment — one descriptor per
option in `packages/server/src/config/registry.ts` — with the effective value, where it came
from (default / environment / override), and whether it can change live. Secrets report only
whether they are set; URL credentials are masked.

Live options (cache TTLs, rate-limit backoff, stale-trade policy, market-hours mode and extended
hours, login-throttle thresholds, worker intervals, watchlist and poller caps) live in
`liveBootConfig` rather than `env` and are read through the app's injected `RuntimeConfig`. An
override is a `system_settings` row keyed `config.override.<KEY>`, audited as
`system.config.override` / `system.config.reset`, applied from the next read, re-applied at boot
(which logs a warning listing them), and wins over the environment until reset. A wait already in
progress finishes first: an active rate-limit backoff or login lockout keeps its expiry. Worker
intervals are the exception — `startIntervalWorker` re-reads its interval at least every 10 s, so
lowering one takes effect within that window. Override bounds are
tighter than environment parsing so a mis-click cannot, say, set a 1 ms cache TTL. Restart-only
options are read-only and say why. The panel also shows the bundle's `VITE_*` build-time values.

### User limits

Every abuse control is a **limit** with a key (`LimitKey`, `packages/shared/src/types/limits.ts`), a catalogue entry (`packages/server/src/limits/catalogue.ts`), and a live option in the `limits` config category that holds its global value. The effective value for a request is resolved in this order (ADR-018):

1. `LIMITS_ENABLED=false` → none
2. admin → none
3. per-user override → that value, and nothing below applies
4. global value, reduced to `LIMITS_PROBATION_PERCENT` (rounded up, at least 1) while the account is younger than `LIMITS_MATURITY_DAYS`. The socket cap (`wsConnections`) is exempt: one game page holds two sockets, so a reduced cap would lock a new player's second device out
5. ×`LIMITS_PRIVILEGED_MULTIPLIER` when the request IP is in `LIMITS_PRIVILEGED_CIDRS`

| Limit | Option | Kind | Default |
|---|---|---|---|
| API requests per user | `LIMIT_API_REQUESTS_PER_MINUTE` | rate | 600/min |
| Trades | `LIMIT_TRADES_PER_MINUTE` | rate | 60/min |
| Order cancels | `LIMIT_ORDER_CANCELS_PER_MINUTE` | rate | 60/min |
| Invite-code lookups | `LIMIT_CODE_LOOKUPS_PER_MINUTE` | rate | 20/min |
| Live `subscribe` frames | `LIMIT_WS_SUBSCRIBES_PER_MINUTE` | rate | 30/min |
| Games created | `LIMIT_GAMES_CREATED_PER_WEEK` | quota | 10 / 7 days |
| Active games owned | `LIMIT_ACTIVE_GAMES_OWNED` | concurrent | 5 |
| Games joined | `LIMIT_GAMES_JOINED_PER_DAY` | quota | 20 / 24 h |
| Active games joined | `LIMIT_ACTIVE_GAMES_JOINED` | concurrent | 30 |
| Open orders per game-player (working + pending) | `LIMIT_OPEN_ORDERS_PER_PLAYER` | concurrent | 50 |
| Watchlists / items per list | `WATCHLIST_MAX_PER_USER` / `WATCHLIST_MAX_ITEMS` | concurrent | 20 / 50 |
| Open live sockets | `LIMIT_WS_CONNECTIONS_PER_USER` | concurrent | 10 |
| Registrations per IP | `LIMIT_REGISTRATIONS_PER_IP_PER_DAY` | per IP | 5 / 24 h |

**Where each kind is counted:**
- Trades, cancels and code lookups: `@fastify/rate-limit`, keyed per user, sized by the resolver (`rateLimitFor`). The two cancel routes share one `app.rateLimit` handler, so they draw on one budget.
- API requests: the in-memory `UsageTracker`, from a global `preHandler`.
- `subscribe` frames: a per-user `SlidingWindowCounter` inside the `/games/:id/live` route, shared across that user's sockets.
- Quotas and the game/watchlist caps: `limits.enforcer.enforce(...)`, counting the real rows (`limits/quota-counts.ts`).
- Open orders: `assertOpenOrderCapacity` inside the order's transaction, with the resolver's max, on both the working and the pending path.
- Sockets: `admitConnection` (`ws/limits.ts`) against both live registries at upgrade.

**How a refusal looks:**
- **HTTP body:** `LimitExceededBody` — `{ error, code: 'LIMIT_EXCEEDED', limit, max, probation, maturityDays?, retryAfterSeconds? }`. `maturityDays` is present only when `probation` is true, so the client can say how long probation lasts.
- **Rates and windowed quotas:** 429 with `Retry-After`. For a quota, the wait is computed from the oldest row still in the window.
- **Concurrent caps:** 409.
- **WebSocket:** a socket past the connection cap is closed with `4429`. A `subscribe` past the frame rate is dropped and answered with the frame `{ event: 'error', data: { code: 'LIMIT_EXCEEDED', limit: 'wsSubscribes' } }`, and the previous subscription stays in force. `useGameSocket` re-sends its current set 60 s later, and again after each further refusal.
- **The pre-existing per-IP route limits** (login, register, refresh, `/stocks/*`, the watchlist write caps, WS upgrades) keep their numbers and stay on when `LIMITS_ENABLED=false`. They gain the privileged multiplier (`withPrivilegedIp`). An admin is exempt only where the route authenticates before the limiter runs (the watchlist writes); the public routes and the WS upgrade caps are not admin-exempt, because the socket authenticates after the upgrade.

**No ceiling for admins or with the off switch.** Admins, and everyone while `LIMITS_ENABLED=false`, have no open-order or watchlist write ceiling. The price poller's fan-out from those rows is still bounded by `PRICE_POLLER_MAX_SYMBOLS`.

**Game bounds are global and not per-user:**
- `GAME_MAX_STARTING_BALANCE`
- `GAME_MAX_DURATION_DAYS`
- `GAME_MAX_START_DELAY_DAYS`
- `GAME_MAX_PLAYERS` (409 `GAME_FULL`)

The first three are checked on `POST /games` (400 `{ error }`, an input error rather than `LIMIT_EXCEEDED`); the player cap is checked on join (409 `GAME_FULL`). Admin edits through `PATCH /admin/games/:id` and admin seating are not checked.

`/games/browse` is paginated. `/public/featured-games` only considers public games with at least two players; it takes the newest qualifying active games, then orders them by the mean percentage return of their top entries, so a huge starting balance cannot buy the top slot on the login page.

**Monitoring.**
- Requests and denials are counted in memory per user (or per IP when logged out), per registered route or limit, per hour. Per-IP route-limit denials are labelled `ip:<METHOD /route>`.
- The `usage-rollup` worker writes them to `api_usage_hourly` / `limit_denials_hourly` every `USAGE_FLUSH_INTERVAL_MS` and prunes after `USAGE_RETENTION_DAYS`. Deleting a user deletes their usage rows and drops their buffered counts (`UsageTracker.forgetUser`); a flush that races the delete can leave one interval behind until the prune.
- `/admin/limits` shows:
  - the policy, including the caller's IP as the server sees it and whether it is privileged (also shown above the Limits card on `/admin/config`)
  - the top consumers over 24 h or 7 d, by requests or by denials
  - every active override
- Each user's admin page has a "Limits & usage" card:
  - effective limit, basis, and usage. `used` is null where it cannot be attributed to the user: the plugin-backed rates (trades, cancels, code lookups), `wsSubscribes`, and the per-IP registration quota. `apiRequests` is the only rate with a value.
  - the override editor
  - the registration IP, with the other accounts registered from it
  - 7-day request volume by route
  - recent denials

---

## System Boundaries

```
Browser (React SPA)
    │
    ├── REST (JSON) ────────────→ Fastify Server
    │                                   │
    ├── WebSocket ──────────────────────┤
    │                                   ├── PostgreSQL / SQLite (Drizzle)
    │                                   ├── Stock Price Provider (pluggable)
    │                                   │       ├── Yahoo Finance (default)
    │                                   │       ├── Alpaca Markets
    │                                   │       └── Polygon.io
    │                                   │
    ├── OTLP /otel ─────────→ OpenTelemetry Collector ←── OTLP (traces/metrics/logs)
    │                                   │
    │                                   └── Prometheus / Tempo / Loki → Grafana
    │
    └── /relay ─────────────→ PostHog ←── posthog-node (events, 5xx) + OTLP logs
```

Both the SPA and the server emit OpenTelemetry over OTLP. The browser's path goes through a
relative `/otel` proxied by nginx (Vite in dev), and trace context propagates from the browser
into the server because API calls are same-origin — a single trace covers a click through to the
upstream price fetch. All of it is inert unless a collector endpoint is configured. See
`docs/observability.md` and ADR-015.

PostHog sits beside it (ADR-016): the SPA reaches it through the same-origin `/relay` proxy, and
the server sends business events from a single subscriber on the domain `EventBus`
(`observability/analytics.ts`) — including `game.created`, the one domain event that exists
only for analytics. `trade.executed` carries an `origin` (`player` / `settler` / `admin`) and
`player.joined` a `joinSource` (`creator` / `invite_code` / `public`).

---

## Key Business Rules

1. **Trade execution is immediate.** Orders fill instantly at the last fetched price. No order book, no bid/ask spread (MVP).
2. **No short selling.** Players can only sell shares they own.
3. **No fractional shares.** Quantity must be a positive integer.
4. **Cash balance must cover the purchase.** `quantity × price ≤ cashBalance` must hold at execution time.
5. **Trades only accepted while game is `active`.** Rejected with 409 if the game is `pending` or `ended`.
6. **Portfolio value** = `cashBalance + Σ(quantity × currentPrice)` for all holdings.
7. **Leaderboard rank** = descending order of portfolio value.

---

## Real-Time Behavior

The server maintains a set of "watched symbols" per active game (union of all symbols any player holds). A price polling loop (configurable interval, default 5s) fetches prices for all watched symbols and broadcasts `price_update` events to all connected clients in that game's WebSocket channel.

After each trade, the server rebroadcasts a `leaderboard_update` event recalculated with the latest prices.

### Connection lifecycle

The server pings every connected socket every `WS_HEARTBEAT_INTERVAL_MS` (default 30s) and terminates any client that missed the previous round trip. This keeps an idle socket from being reaped unannounced by a reverse proxy or NAT table, and clears peers that disappeared without a close frame.

Both browser hooks (`useGameSocket`, `useIndicesSocket`) reconnect through `ReconnectController` in `packages/frontend/src/lib/reconnect.ts`: exponential backoff from 1s to a 30s ceiling, jittered into the lower half of each window, and capped at 10 consecutive attempts. The attempt counter clears only once a connection has stayed open for 30s — clearing it on `open` instead pins a socket that opens and immediately drops to the base delay forever, which is what produced ~15k reconnects/day on the self-hosted instance (issue #27).

Once the attempt budget is spent the hook stops and publishes `offline` on `useConnectionStore`; the `LIVE` pill in `StatusStrip` becomes a retry button. A give-up state also re-tests itself when the browser comes back online or the tab returns to the foreground.

### Price chart

`ChartCanvas` (`frontend/src/components/StockChart.tsx`) draws `GET /stocks/:symbol/history` as a line, area or candlestick series, with an optional volume pane. The choice is a per-browser preference in `chartPrefsStore` (localStorage key `mt:chart`). History bars carry optional `open/high/low/volume`, and a provider that only has closes renders flat candles. The response's `barSeconds` (from `RANGE_BAR_SECONDS` in `providers/interface.ts`) lets the client fold live ticks into the current candle during regular hours.

Inside a game the chart also overlays the viewer's own executed trades as buy/sell markers, snapped to the plotted bar at or before each fill, plus a dashed avg-cost line for a held position. A `trade_executed` event for the viewer's own user id refreshes both. Note that that event's `playerId` is a *user* id.

---

## Feature Roadmap (post-MVP)

These are candidates for future design cycles. None are committed.

- **Limit orders** — place an order at a target price, fill when market crosses it
- **Short selling** — borrow shares to sell, buy back later
- **Admin tools** — game creator can remove players, extend game end date
- **Game templates** — preset configurations (e.g., "30-day $10k challenge")
- **Notifications** — push/email when a trade executes or when you move up/down the leaderboard

---

## Open Questions

| Question | Status |
|---|---|
| Should games be public (discoverable) or private (join by ID only)? | **Resolved 2026-08-13** — both. Public by default with a per-game private opt-out, plus invite links for either. Private games require the invite code to join (enforced server-side on `POST /games/:id/join`, not just at the `/games/by-code/:code` lookup) — raw ID alone is not sufficient once a game is private. |
| What happens to stock price cache when market is closed? | Use last known price, mark as "stale" |
| Should there be a rate limit on trades per player per game? | **Resolved 2026-10-14** — per user rather than per game: `LIMIT_TRADES_PER_MINUTE` (60/min, live, overridable per user). See User limits. |

---

## Known Gaps

### Open orders are capped per game-player

`LIMIT_OPEN_ORDERS_PER_PLAYER` (live, default 50, overridable per user) caps `working` + `pending` rows per
game-player; a bracket counts as three. Placing past it is refused with `LIMIT_EXCEEDED` (409 — it was
422 `TOO_MANY_OPEN_ORDERS` before 2026-10, and that error code is gone). Until
2026-10 the cap was a constant and the pending path (`reservePendingTrade`) skipped it; both paths now count.
The cap exists because every resting order's symbol joins the price poller's 5-second fan-out. Admins, and
everyone while `LIMITS_ENABLED=false`, have no cap; `PRICE_POLLER_MAX_SYMBOLS` still bounds the fan-out.

The count is a read inside the transaction followed by an insert, so on Postgres concurrent placements can
overshoot by roughly the number of in-flight requests. It is per *game-player*, so the per-user ceiling is
this × `LIMIT_ACTIVE_GAMES_JOINED`.

### Open orders can crowd watchlist symbols out of the price poller

The poller's `openOrderSymbols` query covers every active game, not only games with a connected socket, and
open-order symbols rank above watchlist symbols in the `PRICE_POLLER_MAX_SYMBOLS` cut. The user limits bound
one account's contribution (active games joined × open orders per game), but enough accounts with resting
orders on distinct symbols can still push watchlist symbols out of live pricing. The proper fix — weighting
or scoping the open-order set — changes poller semantics and is left for its own change.

### Day orders are the default time-in-force

`timeInForce` defaults to `day`, so a client that omits it gets an order that dies at the next
session close. (Until 2026-10 the pending-orders worker — which runs `expireDayOrders` and
`evaluateTriggers` — started only in `pending` market-hours mode, so on a default `instant`
server resting orders never filled or expired. It now runs in every mode.)

### Order symbol validation fails open when the provider is unavailable

`POST /trades` rejects an order whose symbol the provider reports as
`SYMBOL_NOT_FOUND`, which is what stops a junk ticker becoming a permanent
upstream fetch. `RATE_LIMITED` and other provider errors deliberately do NOT
reject — a provider outage must not block trading. The tradeoff is real and
one-sided: during a rate-limit window, junk symbols can still be stored, and a
GTC order gets no `expiresAt`, so those rows are immortal. The price-poller leg
is bounded by `PRICE_POLLER_MAX_SYMBOLS`, but `evaluateTriggers` fetches one
symbol at a time with no cap.

Not implemented from the finding's own list: negative caching of
`SYMBOL_NOT_FOUND`, cancel-after-N-consecutive-failures, a minimum reservation
value, and any backfill of `expiresAt` for rows already resting in production.

### Day orders expire at the next session close, ignoring half-days

`expiresAt` for a `day`-TIF order is stamped from `nextSessionClose`
(`services/market-calendar.ts`), which models regular and extended hours but not
NYSE half-day early closes. A day order placed the day after Thanksgiving
expires roughly three hours late. Bounded and documented at the call site;
fixing it means teaching the market calendar about early closes.

### Ended games depend on a status write to seal off

`settlePendingTrades` and `evaluateTriggers` both refuse to fill orders in games
whose status is not `active`. Nothing sweeps `games.status` on a timer —
`recomputeGameStatus` runs only from route handlers — so a game whose end date
has passed but which nobody has requested still reads `active` and its queued
orders can still fill. Ranking-neutral today; a scheduled sweeper would close it.

### Resting / pending-market sell realized P&L

For limit/stop sell orders that fill via the trigger worker — and for pending
market sells that settle via the market-hours worker — the portfolio row is
decremented at *placement* (when the order is queued), not at fill. By the time
`executeTrade` (or `settlePendingTrades`) finalises the fill, the cost basis is
already gone. Consequence:

- `ExecuteTradeResult.realizedPnl`, `realizedPnlPct`, `holdDurationMs`, and
  `fullyClosed` are zero/false for these fills.
- The trade-emit helper (`services/trade-emit.ts`) suppresses
  `position.closed` for resting/pending sells (`isResting: true` at the call
  site). The `holdings.changed` event still fires with accurate
  `distinctSymbols` / `topConcentrationRatio` / `cashRatio`.
- Achievements that subscribe to `position.closed` (Moonshot, Ten-Bagger, Bag
  Holder, Catastrophe, Paper Hands, Diamond Hands, First Blood, etc.) will NOT
  fire on resting or pending-market sell fills.

Acceptable for now; revisit by capturing the cost basis at placement time
(e.g. snapshot `avgCostBasis` onto the working/pending `trades` row) once
resting orders become more common.

### Login throttle state is per-process

`FailedLoginTracker` (`services/failed-login.ts`) counts failed logins per
username in memory, so:

- a restart clears every counter, and an attacker who can trigger restarts could
  use that to reset one;
- the counters are not shared between instances, so the effective threshold
  multiplies by the instance count.

Neither matters at the current single-process deployment. Moving to more than one
server instance means moving this state to the database or a shared cache — the
per-IP limiter (`@fastify/rate-limit`, also in-process), the per-user rate windows,
the limit-override cache, and the unflushed `UsageTracker` buffers have the same
constraint (ADR-018).

### Discover's S&P 500 list is maintained by hand

The daily-picks universe is a checked-in snapshot of the index constituents
(`services/discover/sp500.ts`, header gives the as-of date). No stock provider
exposes index membership, so after a rebalance the list drifts until someone
regenerates it. A delisted or renamed symbol does not break anything — its quote
is missing, so the pick shows "—" for price and change — but it keeps being
drawn until the file is refreshed.
