# MarketTrader — Development Plan

This file tracks the overall build plan across multiple sessions. Each phase maps to an implementation plan in `docs/superpowers/plans/`. Update task status as work completes.

---

## Status Legend

- `[x]` Complete
- `[ ]` Not started
- `[~]` In progress

---

## Phase 1: Project Scaffolding ✅

> Plan: `docs/superpowers/plans/2026-05-08-project-scaffolding.md`

- [x] Root pnpm workspace (`package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, ESLint, Prettier)
- [x] Shared types package (`@markettrader/shared`) — auth, game, player, stock, websocket types
- [x] Server skeleton — Fastify app, health endpoint, `buildApp()`, typed env
- [x] Drizzle schema — PostgreSQL + SQLite dual-dialect (users, games, gamePlayers, portfolios, trades, stockPriceCache)
- [x] SQLite migrations generated (`packages/server/drizzle/`)
- [x] Frontend skeleton — React 19 + Vite + Tailwind CSS + ShadCN placeholder page
- [x] Docker Compose (PostgreSQL) + `Dockerfile.server` (multi-stage)
- [x] GitHub Actions CI (typecheck + lint + test)

---

## Phase 2: Authentication API

> Plan file to create: `docs/superpowers/plans/2026-05-XX-auth-api.md`

**Goal:** Users can register and log in. All subsequent requests authenticate via JWT.

- [x] `POST /auth/register` — create user, hash password with argon2, return JWT + user
- [x] `POST /auth/login` — verify password with argon2, return JWT + user
- [x] Refresh token — 7-day HttpOnly cookie, `POST /auth/refresh` endpoint
- [x] JWT Fastify plugin (`@fastify/jwt`) registered in `app.ts`
- [x] Auth middleware/decorator (`request.user`) for protected routes
- [x] DB migration for users table (already in schema, migration needed for prod)
- [x] Vitest integration tests for register, login, invalid credentials, duplicate username

---

## Phase 3: Game & Player API

> Plan file to create: `docs/superpowers/plans/2026-05-XX-game-api.md`

**Goal:** Players can create games, join games, and view the leaderboard.

- [x] `GET /games` — list games the authenticated user is participating in
- [x] `POST /games` — create a game (name, startDate, endDate, startingBalance)
- [x] `POST /games/:id/join` — join a game as a player (creates GamePlayer row)
- [x] `GET /games/:id` — game details + current leaderboard snapshot
- [x] Game status auto-transition logic (pending → active → ended based on dates)
- [x] Leaderboard calculation service (`cashBalance + Σ quantity × currentPrice`)
- [x] Vitest integration tests for all game endpoints

---

## Phase 4: Trading & Stock Price API

> Plan file to create: `docs/superpowers/plans/2026-05-XX-trading-api.md`

**Goal:** Players can buy/sell stocks within active games. Prices come from a pluggable provider.

- [ ] `StockProvider` interface (`getQuote`, `streamQuotes`) in `packages/server/src/providers/`
- [ ] Yahoo Finance provider implementation (default, no key required)
- [ ] Alpaca Markets provider (optional, behind `STOCK_PROVIDER=alpaca` env var)
- [ ] `StockPriceCache` write-through layer (30s TTL)
- [ ] `GET /stocks/:symbol` — return quoted price (cached)
- [ ] `GET /stocks/search?q=` — ticker search results
- [ ] `GET /games/:id/portfolio` — player's current holdings with unrealized P&L
- [ ] `POST /games/:id/trades` — execute buy/sell order
  - Validate: game is `active`, direction, quantity ≥ 1 (integer), sufficient cash/shares
  - Fetch current price, update cashBalance, upsert Portfolio row, insert Trade row (atomic)
- [ ] `GET /games/:id/trades` — player's trade history
- [ ] Trade service unit tests (business logic: buy/sell validation, P&L math)
- [ ] Vitest integration tests for all trading endpoints

---

## Phase 5: WebSocket Server

> Plan file to create: `docs/superpowers/plans/2026-05-XX-websocket.md`

**Goal:** Connected clients receive live price updates and leaderboard changes.

- [ ] `@fastify/websocket` registered before all routes in `app.ts`
- [ ] WebSocket route: `GET /games/:id/live` (upgrades to WS)
- [ ] JWT validation on WS upgrade (from `?token=` query param) — reject 401 if invalid
- [ ] Per-game client registry (track connected sockets by gameId)
- [ ] Price polling loop — every 5s, fetch prices for all symbols held by players in each active game
- [ ] Broadcast `price_update` event to all clients in a game (batched, not per-tick)
- [ ] Broadcast `leaderboard_update` event after each trade (throttled ≤ 1/sec)
- [ ] Broadcast `trade_executed` event when any player trades
- [ ] Client `subscribe` event handler — add symbols to per-client watch list
- [ ] Cleanup on socket `close` and `error` events
- [ ] Integration tests for WS connection, auth rejection, event delivery

---

## Phase 6: Frontend Features

> Plan file to create: `docs/superpowers/plans/2026-05-XX-frontend-features.md`

**Goal:** A working SPA where users can register, create/join games, trade, and watch the leaderboard.

### Auth
- [ ] Login page (`/login`)
- [ ] Register page (`/register`)
- [ ] Auth store (Zustand) — persist JWT, user info
- [ ] React Query hooks for auth endpoints
- [ ] Protected route wrapper (redirect to `/login` if unauthenticated)

### Games
- [ ] Games list page (`/`) — list of active/pending games
- [ ] Create game dialog/page
- [ ] Game detail page (`/:gameId`) — leaderboard, join button

### Trading UI (game context)
- [ ] Portfolio view — holdings table with live P&L (updates from WebSocket)
- [ ] Trade panel — symbol search, buy/sell form, submit
- [ ] Trade history table
- [ ] Real-time leaderboard sidebar (updates from WebSocket)

### WebSocket Client
- [ ] `useGameSocket` hook — connects, authenticates, dispatches incoming events
- [ ] Zustand store slices for live prices and leaderboard

### Charts
- [ ] TradingView Lightweight Chart component for price history per held symbol
- [ ] Candlestick/line chart wired to price data from REST or WebSocket

### Polish
- [ ] Loading and error states on all async operations
- [ ] Responsive layout (Tailwind breakpoints)
- [ ] Dark mode support (ShadCN CSS variables already defined)
- [ ] E2E tests with Playwright (register → join game → buy stock → see leaderboard)

---

## Phase 7: Production Readiness

> Plan file to create when Phase 6 is done.

- [ ] Environment validation — fail fast on missing required env vars in production
- [ ] Rate limiting (`@fastify/rate-limit`) on auth and trade endpoints
- [ ] Helmet headers (`@fastify/helmet`)
- [ ] PostgreSQL migration runner on server startup (or pre-deploy hook)
- [ ] Nginx config for frontend static files + `/api` proxy
- [ ] AWS EC2 deployment guide (Docker Compose, Nginx, env setup)
- [ ] Smoke test against production URL

---

## Current State

**Phase 3 is fully complete.** The Game & Player API is implemented: users can create games (auto-joining as the first player), list their games, join existing games, and view game details with a ranked leaderboard. Game status auto-transitions (pending → active → ended) lazily on read. The leaderboard uses live prices from `stockPriceCache` with an `avgCostBasis` fallback (to be replaced in Phase 4).

**Next step:** Implement Phase 4 (Trading & Stock Price API). Create the plan file at `docs/superpowers/plans/2026-05-XX-trading-api.md` before starting implementation.

---

## Key References

| Document | Purpose |
|---|---|
| `docs/superpowers/specs/2026-05-08-markettrader-design.md` | Full system design spec |
| `docs/design.md` | Living design doc (update when adding features) |
| `docs/technical-decisions.md` | ADR log — check before changing libraries |
| `CLAUDE.md` | Business rules, conventions, env vars, running locally |
