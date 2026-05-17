# Integration Test Suite — Design

**Date:** 2026-05-17
**Status:** Approved (pending user review of this doc)
**Owner:** Tristan

## Goal

Stand up a comprehensive Playwright-driven integration test suite that exercises every server endpoint (REST + WebSocket) and every player-facing and admin UI flow. The suite must be:

- Deterministic and offline-runnable (no live market data dependency).
- Runnable with one command (`pnpm --filter frontend e2e`).
- Built by Claude; run by the user (or CI) — Claude is not in the runtime loop.
- Structured so individual specs are short, focused, and independently debuggable.

## Non-goals

- Replacing the existing unit/component test suite (`packages/frontend/tests/*.test.tsx`, server vitests).
- Load testing, performance benchmarking, or visual regression.
- Mobile / responsive layout coverage.
- Real-provider (Yahoo / Alpaca) integration tests — those remain manual smoke checks.

## Architecture

### High-level layout

Expand the existing `packages/frontend/e2e/` directory (already wired into `playwright.config.ts`). Split specs by audience and concern:

```
packages/frontend/e2e/
  fixtures/
    base.ts              ← extended `test` with reusable fixtures
    mock-prices.ts       ← re-export of server's mock price map
  player/
    auth.spec.ts
    games.spec.ts
    trading.spec.ts
    watchlists.spec.ts
    symbols.spec.ts
    market-status.spec.ts
    websocket.spec.ts
  admin/
    users.spec.ts
    games.spec.ts
    portfolios.spec.ts
    trades.spec.ts
    system.spec.ts
    audit.spec.ts
  api/
    health.spec.ts
    edge-errors.spec.ts
  happy-path.spec.ts     ← rewritten to use new fixtures + mock provider
```

### Coverage philosophy

- **Player + admin UI specs:** drive the browser through real user flows; assert on the rendered DOM. Set up prerequisite state via API fixtures (faster, less brittle than chaining UI flows).
- **API specs:** cover endpoints that have no obvious UI path (e.g. `/auth/refresh`, `/games/:id/trades/pending`, `/admin/users/:id/players`) and consolidate edge-error paths in one file.
- Every endpoint listed in the matrix below is covered exactly once for the happy path; selected endpoints additionally get error-path coverage in `api/edge-errors.spec.ts`.

### Mock StockProvider (server change)

Live market data is replaced with a deterministic in-process mock so prices are stable and tests run offline.

**New file:** `packages/server/src/providers/mock.ts` implementing all four `StockProvider` methods:

- `getQuote(symbol)` — returns from a built-in symbol → price map. Unknown symbols return `$100`. `timestamp = Date.now()`.
- `searchSymbols(query)` — case-insensitive prefix/contains over the built-in map, up to 10 results with stub `name`/`exchange`.
- `getHistory(symbol, range)` — synthesizes deterministic bars seeded by a hash of the symbol so charts render plausibly. Bar counts: ~30 for `1d`/`5d`, ~250 for `1y`, etc. Timestamps anchored to `Date.now()`.
- `getDetails(symbol)` — returns a fixed `StockDetails` with `sector`/`industry`/`marketCap` filled.

**Built-in price map** (initial — extend as specs need):

| Symbol | Price |
|---|---|
| AAPL | 180.00 |
| MSFT | 420.00 |
| GOOG | 140.00 |
| NVDA | 950.00 |
| TSLA | 240.00 |
| AMZN | 200.00 |
| META | 500.00 |
| (other) | 100.00 |

**Wiring:**

- `packages/server/src/env.ts` — add `'mock'` to `VALID_PROVIDERS`.
- `packages/server/src/providers/factory.ts` — add `case 'mock': return new MockProvider();`.
- Optional `MOCK_PRICES` env var (JSON map) overrides the built-in map at boot, for specs that need specific prices for assertions.

**Test-env wiring** (in `packages/frontend/playwright.config.ts`):

```ts
env: {
  DATABASE_URL: ':memory:',
  JWT_SECRET: 'e2e-test-secret-key-for-playwright-only-not-prod',
  CORS_ORIGIN: 'http://127.0.0.1:5173',
  PORT: '3000',
  NODE_ENV: 'test',
  STOCK_PROVIDER: 'mock',
  MARKET_STATUS_PROVIDER: 'static',
  MARKET_HOURS_MODE: 'instant',
}
```

`MARKET_HOURS_MODE=instant` keeps all trades on the immediate-execution path, so we don't need to cover the pending-order subsystem for every trade test. The pending-order endpoints still get their own coverage by temporarily flipping the game (or trade type) to a working/pending order — these tests live in `player/trading.spec.ts`.

**Why server-side, not browser-side mocking:** the server fetches prices, so `page.route()` in Playwright can't influence trade execution prices. Mock at the source.

### Test fixtures (`fixtures/base.ts`)

Custom `test` exported via `test.extend<Fixtures>()`. Fixtures provided:

| Fixture | Scope | Purpose |
|---|---|---|
| `apiClient` | test | Pre-wired `APIRequestContext` against `http://127.0.0.1:3000`. |
| `registerUser` | test (function) | Registers a unique user via `/auth/register`; returns creds + tokens. |
| `loginAs` | test (function) | Calls `/auth/login`; returns tokens. |
| `adminUser` | worker | Registers the FIRST user once per worker (auto-admin per server logic). |
| `playerUser` | test | Registers a fresh non-admin user per test. |
| `makeGame` | test (function) | Creates a game via API. Defaults: 1h window, $100k starting cash. |
| `joinedPlayer` | test (function) | Registers a player + joins given game; returns `{ creds, accessToken, userId }`. |
| `pageAs` | test (function) | Returns a browser page already logged in (writes tokens into localStorage). |
| `adminPage` | test | Convenience: `pageAs(adminUser)`. |
| `playerPage` | test | Convenience: `pageAs(playerUser)` already at the games list. |
| `secondPage` | test (function) | Opens a second browser context as another user (for cross-context WS tests). |

Fixtures use Playwright's request context for API calls so they share the spec's tracing/reporting.

### Data isolation

- `fullyParallel: false` (already configured) — one worker, one shared server process, one in-memory DB per `playwright test` invocation.
- Specs name resources with `<spec>_<Date.now()>_<rand>` suffixes to avoid collisions; specs only assert on resources they created.
- `adminUser` is registered once per worker (the very first user) so the auto-admin rule holds. All other registrations land as non-admin.
- Admin actions with global side-effects (`cache/flush`, `system-settings/ticker-tape PUT`) only assert on values they themselves set.

If suite runtime ever exceeds ~2 min, revisit with `database-per-worker` (would require server change for a worker-scoped in-memory DB).

### WebSocket coverage pattern

Two endpoints:

- `/games/:id/live` — per-game state (trades, leaderboard, portfolios)
- `/ws/live` — global indices ticker

Default pattern: **API-triggered, UI-observed in a single browser context.**

```ts
test('leaderboard updates live when another player trades', async ({
  playerPage, apiClient, makeGame, joinedPlayer,
}) => {
  const game = await makeGame();
  const me = await joinedPlayer(game.id);
  const other = await joinedPlayer(game.id);

  await playerPage.goto(`/games/${game.id}`);
  await playerPage.getByRole('tab', { name: /leaderboard/i }).click();

  const row = playerPage.getByRole('row', { name: new RegExp(other.username) });
  const before = await row.getByTestId('portfolio-value').textContent();

  await apiClient.post(`/games/${game.id}/trades`, {
    headers: { Authorization: `Bearer ${other.accessToken}` },
    data: { symbol: 'AAPL', side: 'buy', quantity: 10 },
  });

  await expect(row.getByTestId('portfolio-value')).not.toHaveText(before!);
});
```

Two-context tests (`secondPage`) used only when the trigger is itself a UI action (e.g. admin uses TickerTapeEditor and a player observes the ticker updating). Limit: ≤3 specs.

No raw WS frame assertions. UI observation is the behavioral contract.

WS spec list (4 tests):

1. Leaderboard updates after another player trades (API-trigger).
2. Open-orders list updates when a working order fills (admin force-execute trigger).
3. Portfolio cell updates when current price changes (admin price-override trigger).
4. Global indices ticker (`/ws/live`) DOM updates over time.

## Endpoint coverage matrix

Legend: **UI** = exercised through a browser flow. **API** = direct `apiClient` call.

### Player REST

| Endpoint | Method | Coverage |
|---|---|---|
| `/health` | GET | API (`api/health.spec.ts`) |
| `/auth/register` | POST | UI + API |
| `/auth/login` | POST | UI + API |
| `/auth/logout` | POST | API |
| `/auth/refresh` | POST | API |
| `/games` | GET | UI |
| `/games` | POST | UI |
| `/games/:id` | GET | UI |
| `/games/:id/join` | POST | UI + API |
| `/public/featured-games` | GET | UI + API |
| `/market/status` | GET | UI + API |
| `/system-settings/ticker-tape` | GET | UI + API |
| `/stocks/search` | GET | UI |
| `/stocks/:symbol` | GET | UI |
| `/stocks/:symbol/details` | GET | UI |
| `/stocks/:symbol/history` | GET | UI |
| `/games/:id/trades` | POST | UI + API (limit/stop/bracket/GTC + error paths) |
| `/games/:id/trades` | GET | UI + API (`?status=working`) |
| `/games/:id/trades/:tradeId` | DELETE | UI + API |
| `/games/:id/trades/pending` | GET | API |
| `/games/:id/trades/pending/:pendingId` | DELETE | API |
| `/games/:id/portfolio` | GET | UI |
| `/watchlists` | GET/POST | UI + API |
| `/watchlists/:id` | PATCH/DELETE | UI + API |
| `/watchlists/:id/symbols` | POST/DELETE | UI + API |

### WebSocket

| Endpoint | Coverage |
|---|---|
| `/games/:id/live` | UI observation (websocket.spec.ts cases 1–3) |
| `/ws/live` | UI observation (websocket.spec.ts case 4) |

### Admin REST

| Endpoint | Method | Coverage |
|---|---|---|
| `/admin/audit` | GET | UI + API (filter combos) |
| `/admin/games` | GET | UI |
| `/admin/games/:id` | GET/PATCH/DELETE | UI + API |
| `/admin/games/:id/owner` | PATCH | API |
| `/admin/games/:id/status` | POST | UI + API |
| `/admin/games/:id/reset` | POST | UI + API |
| `/admin/games/:id/players` | GET/POST | UI + API |
| `/admin/games/:id/players/:playerId` | DELETE | UI + API |
| `/admin/games/:id/trades` | GET | UI |
| `/admin/games/:id/cancel-working-orders` | POST | API |
| `/admin/users` | GET | UI |
| `/admin/users/:id` | GET/PATCH/DELETE | UI + API |
| `/admin/users/:id/players` | GET | API |
| `/admin/users/:id/reset-password` | POST | UI + API |
| `/admin/users/:id/groups/:groupName` | POST/DELETE | API |
| `/admin/players/:playerId/portfolio` | GET | UI |
| `/admin/players/:playerId/cash` | PATCH | UI + API |
| `/admin/players/:playerId/holdings` | POST/DELETE | UI + API |
| `/admin/trades/:id` | DELETE | UI + API |
| `/admin/trades/:id/force-execute` | POST | UI + API |
| `/admin/trades/:id/reverse` | POST | UI + API |
| `/admin/trades/:id/price` | PATCH | UI + API |
| `/admin/stocks/:symbol/price` | PATCH | UI + API |
| `/admin/stocks/cache/flush` | POST | UI + API |
| `/admin/stats` | GET | UI + API |
| `/admin/system-settings/ticker-tape` | PUT | UI + API |

### Edge-error coverage (`api/edge-errors.spec.ts`)

One representative test per status:

- 401: any authenticated route with no `Authorization` header.
- 403: non-admin user hitting `/admin/audit`.
- 404: `/games/:id` with random UUID.
- 409: `POST /games/:id/trades` against a game with status `pending`.
- 422: `INSUFFICIENT_FUNDS`, `INSUFFICIENT_SHARES`, `INVALID_QUANTITY` (trade endpoint).

## Reporter, retries, traces

```ts
reporter: [['line'], ['html', { open: 'never' }]],
retries: 1,            // UI flake protection
trace: 'on-first-retry',
```

API specs explicitly override `retries: 0` per file (`test.describe.configure`) to keep assertion bugs from being masked.

## Existing `happy-path.spec.ts`

Kept, but rewritten to:

- Use the new fixtures (`registerUser`, `makeGame`, etc.).
- Use mock prices (drops the `PLAYWRIGHT_SKIP_NETWORK` gate).
- Asserts on a deterministic post-trade portfolio value (`100000 - 180 = 99820` cash, 1 AAPL holding).

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Mock provider drifts from real provider's response shape | Mock implements the same `StockProvider` interface; server unit tests already cover both Yahoo and Alpaca implementations against this contract. |
| Suite runtime grows | Start with `fullyParallel: false`. Re-evaluate at ~2 min wall-clock with the option of per-worker DB. |
| Selector brittleness in UI specs | Prefer role-based selectors (already the project convention); when a stable selector is missing, add a `data-testid` and update the component in the same PR. |
| WS reconnect/disconnect flakiness | UI assertions use Playwright auto-retry (`expect(...).toHaveText`) with reasonable timeouts; no manual `waitForTimeout`. |
| Admin auto-promotion rule changes | Documented assumption: first registered user in a fresh DB becomes admin. If this changes, `adminUser` fixture and `auth.ts` must update together. |

## Out of scope (for this iteration)

- Per-worker DB / true parallelism.
- Raw WebSocket frame assertions.
- Real-provider canary tests in CI.
- Visual regression / screenshot diffing.
- Mobile viewport flows.

## Open questions

None — scope locked in section-by-section approval on 2026-05-17.

## Implementation handoff

Once this spec is reviewed and approved by the user, implementation planning continues via the `superpowers:writing-plans` skill.
