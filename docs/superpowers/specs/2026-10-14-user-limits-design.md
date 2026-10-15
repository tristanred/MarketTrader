# User Limits — Design

**Date:** 2026-10-14
**Branch:** `feat/user-limits` (stacked on `feat/admin-config-panel`, PR #30 — rebase after it merges)
**Status:** Design approved in brainstorming session; awaiting implementation plan.

---

## 1. Intent

The site is about to open beyond a known circle of friends. Unknown users must not be able to
degrade it — neither by **hard abuse** (request floods, brute-forcing invite codes) nor by
**soft abuse** (a script that slowly creates millions of games over weeks; nothing crashes, but
every honest user's game list becomes unusable).

**Requirements (from the user):**

1. Limit what each user can do — resource creation (games, joins, orders, watchlists) and
   request rates (trades, cancels, general API traffic).
2. Limits are **global**, with **per-user overrides** for one or many users on one or many limits.
3. **Admins are immune** to all limits.
4. **New accounts** run on reduced (probation) limits until they mature, via an `isMatureUser`
   helper — without heavy machinery.
5. **Privileged connections**: an office IP allowlist whose requests get a large multiplier
   (default ×10) on every limit — not unlimited.
6. **Monitoring**: trace which users (and anonymous IPs) cause which resource usage, including
   request volume when nobody is hitting a limit (get ahead of abuse, not just react).
7. **Admin panel** to view and edit global limits, see per-user usage, and manage overrides.

**Success criteria:**

- A script cannot create more than a bounded number of games/joins per user per window, and the
  public game lists stay usable regardless.
- The office can play a launch day from one IP without tripping any limit.
- A new honest player can play normally while on probation.
- An admin can answer "who is generating this load?" from the panel, and raise one user's limit
  in a click.
- Every limit value is live-editable; nothing requires a restart or deploy to tune.

**Assumptions:**

- Single host (per the deployment topology), so in-process state (rate-limit store, override
  cache, usage buffers) is acceptable. A restart resetting in-memory rate windows is tolerated;
  quotas are durable because they count real rows.
- `TRUST_PROXY` is correctly configured on the host, so `request.ip` is the real client IP.

---

## 2. Abuse analysis (current state)

| # | Gap | Where | Kind |
|---|---|---|---|
| 1 | `POST /games` — no per-user cap, no rate limit; games default to **public** | `routes/games.ts:103` | soft |
| 2 | `startingBalance` unbounded → a spam game sorts to the top of `/public/featured-games` (logged-out login page) | `routes/games.ts`, `routes/public-games.ts:98` | soft |
| 3 | Game dates unbounded → snapshot and discover workers write rows for a game ending in 2999 | `routes/games.ts` | soft |
| 4 | `POST /games/:id/join` — no max players per game, no max games per user → sybil-filled leaderboards | `routes/games.ts:299` | soft |
| 5 | `/games/browse`, `/games`, `/games/:id/trades` not paginated | `routes/games.ts:63,188`, `routes/trading.ts:510` | soft |
| 6 | Price poller ranks open-order symbols from *all* active games above watchlists in the 500-symbol cut | `ws/price-poller.ts` | soft (out of scope — §9) |
| 7 | All existing rate limits are **per IP**, in-memory | `plugins/rate-limit.ts` | hard |
| 8 | Order cancel routes have no rate limit; a place/cancel loop spams the game room's broadcast | `routes/trading.ts:563,633` | hard |
| 9 | `GET /games/by-code/:code` has no rate limit → invite-code enumeration | `routes/games.ts:244` | hard |
| 10 | No concurrent WS sockets per user cap; no `subscribe` frame-rate limit | `ws/live-route.ts`, `ws/global-live-route.ts` | hard |
| 11 | `/auth/register` only 10/min/IP, no daily cap → every per-user limit is one registration away from bypass | `routes/auth.ts:86` | sybil |
| 12 | **Bug:** `reservePendingTrade` never checks `MAX_OPEN_ORDERS_PER_PLAYER` | `services/pending-trade.ts:63-136` | bug |
| 13 | Rate-limit denials are not logged or metered | `plugins/rate-limit.ts` | visibility |

---

## 3. Limit model

### 3.1 Three kinds of limit, three mechanisms

| Kind | Example | Counted by | Durable? |
|---|---|---|---|
| `rate` | trades per minute | `@fastify/rate-limit` store, keyed per user | No (in-memory window) |
| `quota` | games created per 7 days | `COUNT(*)` over source rows in a time window | Yes |
| `concurrent` | active games owned, open orders, open sockets | `COUNT(*)` of current rows / live registry | Yes (rows) / live (sockets) |
| `ip` | registrations per IP per day | `COUNT(*)` over `users.registration_ip` / plugin store | Yes for registrations |

They share **one resolver** and **one error shape**, but are deliberately not collapsed into one
counter abstraction.

### 3.2 Resolution order

`resolve(subject, key) → { max: number | null, basis, privileged, probation }` (`null` = unlimited):

1. `LIMITS_ENABLED === false` → `null`, basis `disabled`. (The pre-existing per-IP layer in §4.3 is not
   switched off by this — it predates this feature and stays as the floor.)
2. Subject is an **admin** → `null`, basis `admin`.
3. A **per-user override** exists for `key` → that exact value, basis `override`. No multipliers —
   an override is what the admin deliberately chose.
4. Otherwise start from the base value (the limit's config key):
   - if the limit is probation-eligible and `!isMatureUser(account)` →
     `max(1, ceil(base × LIMITS_PROBATION_PERCENT / 100))`, basis `probation`;
   - else basis `base`.
5. If `isPrivilegedConnection(request.ip)` → multiply by `LIMITS_PRIVILEGED_MULTIPLIER`,
   `privileged: true`.

`ip`-kind limits have no user: they skip steps 2–4 (except admin immunity where the route is
authenticated) and apply only the base value and step 5.

### 3.3 Helpers

```ts
isMatureUser(account: { createdAt: string }, config: ConfigReader, now = Date.now()): boolean
// account age ≥ LIMITS_MATURITY_DAYS

isPrivilegedConnection(ip: string, config: ConfigReader): boolean
// ip ∈ LIMITS_PRIVILEGED_CIDRS (comma-separated IPs/CIDRs, IPv4 and IPv6)
```

`LIMITS_PRIVILEGED_CIDRS` is parsed per use (live option); the parse is memoised on the raw
string so it is not re-parsed every request.

### 3.4 Policy options (live, category `limits`)

| Key | Kind | Default | Bounds |
|---|---|---|---|
| `LIMITS_ENABLED` | boolean | `true` | — |
| `LIMITS_MATURITY_DAYS` | integer | 7 | 0–365 |
| `LIMITS_PROBATION_PERCENT` | integer | 25 | 1–100 |
| `LIMITS_PRIVILEGED_CIDRS` | string | `""` | ≤ 2048 chars, validated as IP/CIDR list |
| `LIMITS_PRIVILEGED_MULTIPLIER` | integer | 10 | 1–1000 |
| `USAGE_FLUSH_INTERVAL_MS` | integer (ms) | 60000 | 5000–600000 |
| `USAGE_RETENTION_DAYS` | integer | 30 | 1–365 |

---

## 4. Limit catalogue

All are live options in the `limits` config category, overridable per user (except `ip` kind and
the per-game cap), ×multiplier on privileged IPs, and skipped for admins. "Probation" column is
the value at the default 25%.

### 4.1 Per-user rates (`rate`)

| Limit key | Config key | Applies to | Window | Default | Probation |
|---|---|---|---|---|---|
| `apiRequests` | `LIMIT_API_REQUESTS_PER_MINUTE` | every authenticated, non-admin REST route | 1 min | 600 | 150 |
| `trades` | `LIMIT_TRADES_PER_MINUTE` | `POST /games/:id/trades` | 1 min | 60 | 15 |
| `orderCancels` | `LIMIT_ORDER_CANCELS_PER_MINUTE` | `DELETE /games/:id/trades/:tradeId`, `DELETE /games/:id/trades/pending/:pendingId` | 1 min | 60 | 15 |
| `codeLookups` | `LIMIT_CODE_LOOKUPS_PER_MINUTE` | `GET /games/by-code/:code` | 1 min | 20 | 5 |
| `wsSubscribes` | `LIMIT_WS_SUBSCRIBES_PER_MINUTE` | `subscribe` frames, counted per user across sockets | 1 min | 30 | 8 |

`apiRequests` is enforced by the `UsageTracker` (§6), not by `@fastify/rate-limit`, because a
route can only carry one `config.rateLimit`.

### 4.2 Quotas and concurrent caps

| Limit key | Config key | Counts | Kind | Default | Probation |
|---|---|---|---|---|---|
| `gamesCreated` | `LIMIT_GAMES_CREATED_PER_WEEK` | `games` where `created_by = me` and `created_at` within 7 days | quota | 10 | 3 |
| `activeGamesOwned` | `LIMIT_ACTIVE_GAMES_OWNED` | `games` where `created_by = me` and `status ≠ 'ended'` | concurrent | 5 | 2 |
| `gamesJoined` | `LIMIT_GAMES_JOINED_PER_DAY` | `game_players` where `user_id = me` and `joined_at` within 24 h (includes the creator row of games I create) | quota | 20 | 5 |
| `activeGamesJoined` | `LIMIT_ACTIVE_GAMES_JOINED` | `game_players` for me in games with `status ≠ 'ended'` | concurrent | 30 | 8 |
| `openOrders` | `LIMIT_OPEN_ORDERS_PER_PLAYER` (replaces the `MAX_OPEN_ORDERS_PER_PLAYER` constant) | `trades` with status `working` **or `pending`** for this game-player | concurrent | 50 | 13 |
| `watchlists` | `WATCHLIST_MAX_PER_USER` (existing) | watchlists owned | concurrent | 20 | 5 |
| `watchlistItems` | `WATCHLIST_MAX_ITEMS` (existing) | items in the target list | concurrent | 50 | 13 |
| `wsConnections` | `LIMIT_WS_CONNECTIONS_PER_USER` | open sockets for the user across both registries | concurrent | 10 | 3 |

Creating a game checks both `gamesCreated` and `activeGamesOwned`, and — because the creator joins
their own game — `gamesJoined` and `activeGamesJoined`. Joining checks the two join limits.

### 4.3 Per-IP (`ip`)

| Limit key | Config key | Applies to | Default |
|---|---|---|---|
| `registrationsPerIp` | `LIMIT_REGISTRATIONS_PER_IP_PER_DAY` | `POST /auth/register` — `COUNT(users)` with this `registration_ip` in last 24 h | 5 (50 on a privileged IP) |

Existing per-IP `@fastify/rate-limit` configs (login 5/min, register 10/min, logout, refresh,
`/stocks/*`, watchlist items, WS upgrades) keep their hard-coded numbers but their `max`
becomes a function applying the privileged multiplier (and admin immunity where `request.account`
is known). This is the IP layer underneath the per-user layer — same two-layer principle as the
login controls; neither replaces the other.

### 4.4 Phase 0 — global validation fixes (not per-user)

| Change | Mechanism |
|---|---|
| `GAME_MAX_STARTING_BALANCE` (live, default 10 000 000, bounds 1 000–1 000 000 000) | route check on `POST /games`; `PATCH /admin/games/:id` is not checked (admin-exempt) |
| `GAME_MAX_DURATION_DAYS` (live, 365) — `endDate − startDate` | route check on `POST /games` |
| `GAME_MAX_START_DELAY_DAYS` (live, 90) — `startDate − now` | route check on `POST /games` |
| `GAME_MAX_PLAYERS` (live, 100) — per game, **not** user-overridable | `POST /games/:id/join` → 409 `GAME_FULL`; admin `POST /admin/games/:id/players` exempt |
| Pending orders count toward `openOrders` | fix in `reservePendingTrade` (bug #12) |
| `/games/browse` pagination: `limit` (default 20, max 50) + `offset`, response `{ games, total }` | server + shared type + frontend "Load more" |
| `/public/featured-games`: only games with ≥ 2 players qualify; rank by **average % return of the top entries** instead of summed absolute value | `routes/public-games.ts` |

Validation failures use the existing 400 validation-error shape (they are input errors, not limits).

---

## 5. Architecture

### 5.1 Data model (both `schema.sqlite.ts` and `schema.pg.ts`, two generated migrations)

```
user_limit_overrides
  user_id     text  FK → users.id  ON DELETE CASCADE
  limit_key   text  (a LimitKey)
  value       integer  (≥ 1)
  note        text  nullable  (≤ 500 chars — why the override exists)
  updated_by  text  nullable  (admin user id, no FK — mirrors system_settings)
  updated_at  text / timestamp
  PRIMARY KEY (user_id, limit_key)

users.registration_ip   text nullable   -- new column; null for pre-existing accounts
  INDEX (registration_ip, created_at)

api_usage_hourly
  subject_type  text  ('user' | 'ip')
  subject_id    text  (user id or IP)
  route         text  (method + registered route pattern, e.g. "POST /games/:id/trades")
  hour_start    text / timestamp  (UTC, truncated to the hour)
  count         integer
  PRIMARY KEY (subject_type, subject_id, route, hour_start)
  INDEX (hour_start)

limit_denials_hourly
  subject_type  text
  subject_id    text
  limit_key     text
  hour_start    text / timestamp
  count         integer
  first_at      text / timestamp
  last_at       text / timestamp
  PRIMARY KEY (subject_type, subject_id, limit_key, hour_start)
  INDEX (hour_start)

INDEX games(created_by, created_at)
INDEX game_players(user_id, joined_at)
```

Rollup tables carry no FK to `users` (subjects may be IPs; deleting a user should not fail on
usage history). Deleting a user deletes their `user`-subject usage rows in the same transaction.

### 5.2 Request account (`request.account`)

`verifyAccessToken` already reads the `users` row on every authenticated request. Widen that one
query to also select `created_at` and an `EXISTS` subquery on `user_groups` for `ADMIN_GROUP_ID`,
and decorate:

```ts
request.account = { id, createdAt, isAdmin }   // undefined on unauthenticated requests
```

No new query, no cache: a demoted admin loses immunity on the next request — the same freshness
guarantee `disabled` already has. Both WS upgrade handlers already read the user row; widen those
reads the same way to build the account for WS limits.

### 5.3 Server module layout — `packages/server/src/limits/`

| File | Responsibility |
|---|---|
| `catalogue.ts` | `LIMIT_CATALOGUE: { [K in LimitKey]: LimitDescriptor }` — config key, kind, window ms, `probation: boolean`, `overridable: boolean`, label. `satisfies` makes a missing key a type error. |
| `policy.ts` | `isMatureUser`, `isPrivilegedConnection`, CIDR parsing (memoised per raw string). |
| `overrides.ts` | `LimitOverridesService(db)` — `forUser(userId)` (via bounded in-process cache, invalidated on write), `set(adminId, userId, key, value, note)`, `clear(...)`, `listAll()`. Writes in a transaction with `recordAdminAction(tx, { action: 'user.limit.override' / 'user.limit.reset', targetType: 'user', targetId })`. |
| `resolver.ts` | `LimitResolver(config, overrides)` — `resolve(subject, key)` per §3.2. |
| `errors.ts` | `LimitExceededError` (key, max, basis, retryAfterSeconds?) + an error-handler mapping to the HTTP body (§5.5). |
| `enforce.ts` | `limits.enforce(request, key, count: () => Promise<number>)` for quota/concurrent kinds; `limits.retryAfterFor(...)` for windowed quotas. |
| `rate.ts` | `rateLimitFor(key)` → route `config.rateLimit` object; `withPrivilegedIp(max)` wrapper for the existing per-IP configs. |
| `usage-tracker.ts` | `UsageTracker` (§6.1) — in-memory request and denial aggregation; also enforces `apiRequests`. |
| `usage-store.ts` | Flush/upsert into rollup tables, prune, and the read queries for the admin API. |
| `index.ts` | `createLimits({ db, config, disabled })` → `{ resolver, overrides, enforce, tracker, ... }` constructed once in `buildApp`. |

`LimitKey`, `LimitBasis`, `LimitExceededBody`, and the admin DTOs live in
`packages/shared/src/types/limits.ts`.

### 5.4 Enforcement points

**Rate (`@fastify/rate-limit`)** — `rateLimitFor('trades')` returns:

```ts
{
  timeWindow: descriptor.windowMs,
  keyGenerator: (req) => `u:${req.account!.id}`,
  max: async (req) => resolver.resolve(subjectOf(req), 'trades').max ?? Number.MAX_SAFE_INTEGER,
  allowList: (req) => disabled || req.account?.isAdmin === true,
}
```

Per-route `allowList` overrides the plugin-level `allowList: () => true` that tests use, so the
route-level function **must** honour the same `disabled` flag. Route `onRequest` order is
`[authenticate, rateLimiter]` (verified: the plugin appends its hook), so `request.account`
exists when `keyGenerator` / `max` run.

`onExceeded` (plugin-level) records a denial in the `UsageTracker` and the OTel counter, for both
the new per-user configs and the existing per-IP ones (gap #13).

**Global ceiling (`apiRequests`)** — a global `preHandler` hook (runs after the route's
`onRequest: authenticate`): if `request.account` and not admin, `tracker.hit(...)` and compare
the user's last-60-s count against the resolved max; over → `LimitExceededError`. Admin routes
and `/health`, `/version`, `/docs` are excluded.

**Quota / concurrent** — in the route, immediately before the insert. Open orders are checked inside
the insert transaction; game create/join check just before it, because the invite-code retry loop
catches unique-constraint errors, which would abort a Postgres transaction:

```ts
await limits.enforce(request, 'gamesCreated', () => countGamesCreatedSince(tx, userId, weekAgo));
```

Two concurrent requests may overshoot a cap by one. Accepted as a soft limit (documented).

`POST /games/:id/trades` swaps its old per-IP 30/min config for the per-user `trades` limit — a
route carries one `config.rateLimit`, and the `apiRequests` ceiling still bounds it per user.
Open-order denials change from 422 `TOO_MANY_OPEN_ORDERS` to 409 `LIMIT_EXCEEDED`.

**Registration** — `POST /auth/register` stores `request.ip` in `registration_ip` and enforces
`registrationsPerIp` against `COUNT(users WHERE registration_ip = ip AND created_at > now − 24h)`.

**WebSockets**

- `wsConnections`: checked at upgrade, after auth, by counting the user's entries across both
  registries. Over the limit → close with **`4429`** (`WS_LIMIT_EXCEEDED_CLOSE_CODE`, added to
  `ws/close-codes.ts`). Kept disjoint from 1008 (credential) and 4400 (invalid frame).
- `wsSubscribes`: counted per user across sockets in the `UsageTracker`. An over-limit `subscribe`
  is **dropped** (previous subscription stays in force), the server replies
  `{ type: 'error', code: 'LIMIT_EXCEEDED', limit: 'wsSubscribes' }`, and a denial is recorded.
  The socket is not closed: closing would give the client a fresh socket and an immediate
  re-subscribe, which throttles nothing.
- Frontend: both socket hooks treat a `4429` close as a normal backoff case (never `tryRefresh`);
  `useGameSocket` debounces `subscribe` sends (250 ms) so honest clients never approach the cap.

### 5.5 Error shape

```ts
// packages/shared/src/types/limits.ts
interface LimitExceededBody {
  error: string;                 // human-readable, e.g. "Game creation limit reached (3 per week)"
  code: 'LIMIT_EXCEEDED';
  limit: LimitKey;
  max: number;
  probation: boolean;            // true when the account's limit is reduced for being new
  retryAfterSeconds?: number;
}
```

- `rate` and windowed `quota` → **429** with `Retry-After`. For quotas, retry-after = (oldest
  counted row's timestamp + window) − now.
- `concurrent` → **409** (matches the existing watchlist convention; the watchlist 409s gain this
  body).
- `@fastify/rate-limit`'s `errorResponseBuilder` is set so its 429s use the same body.
- Frontend `toastApiError` recognises `code === 'LIMIT_EXCEEDED'`, renders the message plus a
  humanised retry time, and appends "New accounts have lower limits for their first N days" when
  `probation` is true.

---

## 6. Monitoring

### 6.1 `UsageTracker` (in-process)

- **Requests:** an `onResponse` hook increments `(subjectType, subjectId, route, hourStart)`.
  Subject is `user:<id>` when `request.account` exists, else `ip:<request.ip>`. `route` is
  `${method} ${request.routeOptions.url}` (registered pattern — bounded cardinality); unmatched
  routes (404) are aggregated as `"* <unmatched>"`.
- **Denials:** every limit denial (rate plugin `onExceeded`, `LimitExceededError`, WS) increments
  `(subjectType, subjectId, limitKey, hourStart)` with first/last timestamps.
- **Global ceiling:** a per-user sliding 60-s counter (two fixed 30-s buckets, weighted) backs
  `apiRequests`. Pruned as buckets roll.
- **Bounded:** at most 50 000 request keys and 10 000 denial keys buffered; past that, counts go
  to an overflow key (`subjectId = '*overflow*'`) and a warning is logged once per flush.

### 6.2 `usage-rollup` worker

`startUsageRollupWorker({ db, tracker, config })` via `startIntervalWorker`, interval
`() => config.get('USAGE_FLUSH_INTERVAL_MS')`. Each tick:

1. Swap the tracker's buffers (no lost increments while flushing).
2. Upsert-add into `api_usage_hourly` and `limit_denials_hourly`
   (`onConflictDoUpdate` with `count = count + excluded.count`, `last_at = excluded.last_at`).
3. Prune rows with `hour_start` older than `USAGE_RETENTION_DAYS`.

Also flushed from `onClose` so a graceful shutdown loses nothing. A crash loses at most one
interval — acceptable for monitoring. Started alongside the other workers (inside
`!disablePoller`); tests drive `runUsageRollupTick` directly.

### 6.3 OTel

One new counter `markettrader.limits.denied`, attribute `limit` (bounded set of `LimitKey`s plus
`ip:<route>` for existing per-IP configs). No user attribute (cardinality rule). Added to
`docs/observability.md`.

### 6.4 Admin API (all `onRequest: requireAdmin`)

| Route | Returns |
|---|---|
| `GET /admin/limits/top?window=24h\|7d&metric=requests\|denials&limit≤100` | Top subjects: subject type/id, username (users), count, top route or limit key, `sharedRegistrationIpCount`. Merges the unflushed in-memory buffer so it is current. |
| `GET /admin/limits/policy` | Policy option values, the caller's `request.ip` as the server sees it, and whether it is privileged. |
| `GET /admin/limits/overrides` | All overrides with username, note, updatedBy, updatedAt. |
| `GET /admin/users/:id/limits` | Per `LimitKey`: effective max resolved for a **non-privileged** connection (the UI notes "×N on privileged IPs" beside it, since privilege depends on where a request comes from, not who the user is), basis, base value, override, current usage (live count for quota/concurrent; in-memory window for rates), plus `registrationIp`, sibling accounts sharing it, 7-day request volume by route (top 10), and denials in the last 7 days. |
| `PUT /admin/users/:id/limits/:key` | Body `{ value: int ≥ 1, note?: string ≤ 500 }`. 404 unknown user, 404 `UNKNOWN_LIMIT_KEY`, 409 `LIMIT_NOT_OVERRIDABLE` for `ip` kinds. Audited. |
| `DELETE /admin/users/:id/limits/:key` | Clears; audited only if a row was removed. |

Override `value` bounds reuse the target config key's `max` from the registry (an override may
exceed the global default but not the registry's ceiling).

---

## 7. Admin UI (`packages/frontend`)

- **`/admin/config`** — new keys render automatically in the existing "Limits" category. Add a
  banner above that card: "Your IP as the server sees it: `x.x.x.x` — privileged ✓/✗" (from
  `GET /admin/limits/policy`).
- **New page `/admin/limits`** (`pages/admin/AdminLimitsPage.tsx`, `NAV_LINKS` entry "Limits"):
  1. **Top consumers** — metric toggle (requests/denials), window toggle (24h/7d), table: subject
     (username link or IP), count, top route/limit, ⚠ badge when `sharedRegistrationIpCount > 0`.
  2. **Active overrides** — table with user link, limit label, value, note, set by/at, clear
     button (`ConfirmDialog`).
  3. **Policy summary** — maturity days, probation %, privileged CIDRs, multiplier, enabled state;
     links to `/admin/config` for editing (no second editor).
- **`AdminUserDetailPage`** — new **"Limits & usage"** card (`components/admin/UserLimitsCard.tsx`):
  per-limit table (label, effective max, basis badge, usage bar `used / max`, inline override
  editor with note, reset), registration IP with sibling-account links, request volume by route
  (7d, top 10, table), recent denials.
- **API client** `api/admin/limits.ts` — React Query hooks mirroring the routes; mutations
  invalidate `['admin','limits']` and the user detail.
- **Player side** — no usage dashboard. Limit errors surface through `toastApiError` (§5.5).
  `/games/browse` gets "Load more" for pagination.

---

## 8. Testing

- **Fixtures:** `createTestAppWithDb` gains `limits?: { disabled?: boolean }`, default
  `disabled: true` (like `loginThrottle`), so the existing ~890 server tests are untouched.
  Limit tests pass `limits: { disabled: false }` and set values with
  `RuntimeConfig.fromEnvironment({...})` / `config.set`.
- **Unit:** resolver precedence matrix (disabled, admin, override, probation, privileged, and
  combinations; rounding `ceil`, floor 1); `isMatureUser` boundary; CIDR parsing (v4, v6,
  single IPs, invalid entries rejected by the descriptor's validation); catalogue completeness
  (every `LimitKey` has a descriptor and a live config key in `limits`); `UsageTracker` bounds,
  overflow, buffer swap; sliding-window ceiling.
- **Integration (per limit):** exceeding request → correct status + `LimitExceededBody`; admin
  immune; override raises it; privileged IP (`inject({ remoteAddress })`) multiplies it; fresh
  account gets probation; `LIMITS_ENABLED=false` lifts everything.
- **Regression:** pending orders count toward `openOrders`; Phase 0 validations; browse
  pagination; featured-games ranking ignores absolute balance and single-player games.
- **WS:** connection over cap closes `4429`; over-limit `subscribe` gets an error frame and the
  previous subscription remains.
- **Monitoring:** rollup tick upserts and accumulates; prune respects retention; `/admin/limits/top`
  merges unflushed buffers; user deletion removes usage rows.
- **Admin routes:** 401/403 guards; override set/reset audited; bounds validation;
  `LIMIT_NOT_OVERRIDABLE`.
- **Frontend:** `toastApiError` limit mapping; `UserLimitsCard` and `AdminLimitsPage` render and
  mutate; reconnect hooks treat `4429` as backoff; one Playwright flow (admin sets an override,
  user can then create one more game).
- **Schema:** migrations generated for both dialects; registry test confirms every new live
  integer has bounds.

---

## 9. Out of scope

- **Price-poller crowding by open orders** (gap #6). Per-user quotas bound one user's
  contribution, but the real fix changes poller semantics. Recorded as a Known Gap in
  `docs/design.md`.
- Email verification, captcha, admin approval / invite-only registration.
- Player-facing usage dashboard; per-user usage charts over time (admin tables only).
- Multi-instance shared state (Redis store) — single host assumed; noted alongside the existing
  "Login throttle state is per-process" gap.
- Pagination of `GET /games` and `GET /games/:id/trades` (bounded per user by the new
  quotas; revisit if needed).

---

## 10. Documentation and rollout

- **ADR-017** in `docs/technical-decisions.md`: per-user limits layered on `@fastify/rate-limit`
  with an async resolver; durable quotas counted from source tables rather than counter tables;
  usage aggregated in memory and rolled up hourly; single-host assumption.
- **`docs/design.md`**: new "User limits" section; Open Question "rate limit on trades per
  player" resolved; Known Gaps updated (poller crowding; open-order cap now live and includes
  pending).
- **`CLAUDE.md`**: "User limits" section — how to add a limit (catalogue entry + live config key +
  enforcement point), admin immunity, the `4429` close code in the WS conventions, and the PII
  inventory rule.
- **`docs/pii-inventory.md`** (new, living): every personal datum stored — username, password hash,
  `registration_ip`, IPs in `api_usage_hourly` / `limit_denials_hourly`, PostHog `distinctId` /
  replay, request logs — with location, purpose, retention, and visibility. CLAUDE.md rule: update
  it in the same change that starts storing new personal data.
- **`docs/observability.md`**: `markettrader.limits.denied`.
- **`.env.example`**: every new option, commented.
- **Commit order (each phase green):** Phase 0 fixes → catalogue + policy + resolver + overrides
  → enforcement (REST, registration, WS) → monitoring (tracker, rollup, admin API) → admin UI →
  docs.
- **Deployment callout:** no new required env vars, no proxy routes. The deployment side must
  **verify `TRUST_PROXY` matches the nginx hop** on the host — the privileged allowlist and every
  per-IP limit depend on `request.ip`.
- **Defaults ship live.** Existing accounts are older than 7 days and therefore mature;
  `LIMITS_ENABLED=false` from the panel is the emergency off switch.
