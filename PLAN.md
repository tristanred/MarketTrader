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

## Phase 4: Trading & Stock Price API ✅

> Plan: `docs/superpowers/plans/2026-05-09-trading-api.md`

**Goal:** Players can buy/sell stocks within active games. Prices come from a pluggable provider.

- [x] `StockProvider` interface (`getQuote`, `searchSymbols`) in `packages/server/src/providers/`
- [x] Yahoo Finance provider implementation (default, no key required)
- [x] Alpaca Markets provider (optional, behind `STOCK_PROVIDER=alpaca` env var)
- [x] `StockPriceCache` write-through layer (30s TTL)
- [x] `GET /stocks/:symbol` — return quoted price (cached)
- [x] `GET /stocks/search?q=` — ticker search results
- [x] `GET /games/:id/portfolio` — player's current holdings with unrealized P&L
- [x] `POST /games/:id/trades` — execute buy/sell order
  - Validate: game is `active`, direction, quantity ≥ 1 (integer), sufficient cash/shares
  - Fetch current price, update cashBalance, upsert Portfolio row, insert Trade row (atomic)
- [x] `GET /games/:id/trades` — player's trade history
- [x] Trade service unit tests (business logic: buy/sell validation, P&L math)
- [x] Vitest integration tests for all trading endpoints

---

## Phase 5: WebSocket Server

> Plan file to create: `docs/superpowers/plans/2026-05-XX-websocket.md`

**Goal:** Connected clients receive live price updates and leaderboard changes.

- [x] `@fastify/websocket` registered before all routes in `app.ts`
- [x] WebSocket route: `GET /games/:id/live` (upgrades to WS)
- [x] JWT validation on WS upgrade (from `?token=` query param) — reject 401 if invalid
- [x] Per-game client registry (track connected sockets by gameId)
- [x] Price polling loop — every 5s, fetch prices for all symbols held by players in each active game
- [x] Broadcast `price_update` event to all clients in a game (batched, not per-tick)
- [x] Broadcast `leaderboard_update` event after each trade (throttled ≤ 1/sec)
- [x] Broadcast `trade_executed` event when any player trades
- [x] Client `subscribe` event handler — add symbols to per-client watch list
- [x] Cleanup on socket `close` and `error` events
- [x] Integration tests for WS connection, auth rejection, event delivery

---

## Phase 6: Frontend Features

> Plan file to create: `docs/superpowers/plans/2026-05-XX-frontend-features.md`

**Goal:** A working SPA where users can register, create/join games, trade, and watch the leaderboard.

### Auth
- [x] Login page (`/login`)
- [x] Register page (`/register`)
- [x] Auth store (Zustand) — in-memory JWT + user, session restored via `/auth/refresh` on load
- [x] React Query hooks for auth endpoints
- [x] Protected route wrapper (redirect to `/login` if unauthenticated)

### Games
- [x] Games list page (`/`) — list of active/pending games
- [x] Create game dialog/page
- [x] Game detail page (`/:gameId`) — leaderboard, join button

### Trading UI (game context)
- [x] Portfolio view — holdings table with live P&L (updates from WebSocket)
- [x] Trade panel — symbol search, buy/sell form, submit
- [x] Trade history table
- [x] Real-time leaderboard sidebar (updates from WebSocket)

### WebSocket Client
- [x] `useGameSocket` hook — connects, authenticates, dispatches incoming events
- [x] Zustand store slices for live prices and leaderboard

### Charts
- [x] TradingView Lightweight Charts component for price history per held symbol
- [x] Line chart wired to price data from WebSocket ticks (historical data deferred to a later phase)

### Polish
- [x] Loading and error states on all async operations
- [x] Responsive layout (Tailwind breakpoints)
- [x] Dark mode support (ShadCN CSS variables already defined)
- [x] E2E tests with Playwright (register → join game → buy stock → see leaderboard)

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

**Phases 1–6 are fully complete.** The React SPA is now a working tournament client: users can register, sign in, create or join games, search tickers, place buy/sell orders, and watch their portfolio and the leaderboard update live via WebSocket. Access tokens live in a non-persisted Zustand store; sessions survive reloads by silently calling `/auth/refresh` against the HttpOnly cookie. Live price ticks feed a TradingView Lightweight Charts line series. Dark mode toggle, responsive layout, loading skeletons, and toast notifications are in place. A Playwright happy-path E2E spec covers register → create game → trade → portfolio.

**Next step:** Phase 7 (Production Readiness) — env validation, rate limiting hardening, Helmet, PG migrations on startup, Nginx + EC2 deployment guide.

---

## Key References

| Document | Purpose |
|---|---|
| `docs/superpowers/specs/2026-05-08-markettrader-design.md` | Full system design spec |
| `docs/design.md` | Living design doc (update when adding features) |
| `docs/technical-decisions.md` | ADR log — check before changing libraries |
| `CLAUDE.md` | Business rules, conventions, env vars, running locally |
