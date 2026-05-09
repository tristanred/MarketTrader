# MarketTrader

A virtual stock trading tournament platform. Groups of friends create a **game**, start with equal virtual cash, and compete to build the most valuable portfolio by trading real stocks at real market prices. A real-time leaderboard tracks rankings throughout the game.

---

## What It Does

- **Create a game** — set a start/end date and a starting cash balance for all players
- **Join and compete** — invite friends; everyone starts with the same amount of virtual money
- **Trade real stocks** — buy and sell shares at live market prices (via Yahoo Finance by default)
- **Live leaderboard** — real-time WebSocket updates show who's winning as prices move
- **Fair rules** — no short selling, no fractional shares, trades only execute when the game is active

---

## Architecture

```
packages/
  server/     ← Fastify 5 REST API + WebSocket server (Node.js + TypeScript)
  frontend/   ← React 19 + Vite SPA
  shared/     ← TypeScript types only — API contracts shared between server and frontend
```

pnpm workspace monorepo. The `shared` package is the single source of truth for all API types — changes to the API surface produce TypeScript errors in both the server and the frontend before they reach runtime.

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Package manager | pnpm workspaces | Fast, disk-efficient, strict hoisting |
| Server framework | Fastify 5 | Lowest overhead, schema-first, async-native |
| ORM | Drizzle ORM | Type-safe SQL, zero runtime overhead, dual-dialect |
| Database (prod) | PostgreSQL 16 | ACID, proven at scale |
| Database (dev/test) | SQLite (better-sqlite3) | Zero setup, in-memory for tests |
| WebSocket | `@fastify/websocket` | Native Fastify integration, no Socket.io overhead |
| Auth | JWT + argon2 | Short-lived access tokens (15 min), 7-day refresh cookies |
| Frontend framework | React 19 | Concurrent features, stable ecosystem |
| Build tool | Vite 6 | Fastest HMR, native ESM, first-class TypeScript |
| Charts | TradingView Lightweight Charts | Purpose-built for financial data |
| UI components | ShadCN/UI + Tailwind CSS | Copy-own components, utility-first styling |
| Server state | React Query v5 | Caching, background refresh, optimistic updates |
| Client state | Zustand | Minimal, zero-boilerplate global state |
| Stock data | Pluggable `StockProvider` | Yahoo Finance default, swap to Alpaca/Polygon via env var |

---

## Getting Started

### Prerequisites

- Node.js 22+
- pnpm (via corepack): `corepack enable`
- g++ 10+ (for `better-sqlite3` native compilation)
- Docker (optional, for PostgreSQL in dev)

### Local development with SQLite

```bash
# Install dependencies
pnpm install

# Start the server (SQLite, no Docker needed)
DATABASE_URL=./dev.db JWT_SECRET=$(openssl rand -hex 32) pnpm --filter server dev

# Start the frontend
pnpm --filter frontend dev
```

The frontend proxies `/api` requests to `http://localhost:3000`, so both services can run independently.

### Local development with Docker (PostgreSQL)

```bash
cp .env.example .env
# Edit .env — set JWT_SECRET to a real random value

docker-compose up
```

### Running tests

```bash
# All packages (SQLite in-memory)
DATABASE_URL=:memory: JWT_SECRET=dev pnpm test

# Watch mode for a single package
pnpm --filter server test:watch
```

### Type checking and linting

```bash
pnpm typecheck   # All packages
pnpm lint        # All packages
pnpm build       # Full production build
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `./dev.db` | Postgres URL (`postgres://...`) or SQLite path. `:memory:` for tests. |
| `JWT_SECRET` | — | **Required.** Random 64-char hex string. Generate: `openssl rand -hex 32` |
| `PORT` | `3000` | HTTP server port |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed frontend origin |
| `STOCK_PROVIDER` | `yahoo` | `yahoo` \| `alpaca` \| `polygon` |
| `ALPACA_API_KEY` | — | Required when `STOCK_PROVIDER=alpaca` |
| `NODE_ENV` | `development` | `development` \| `production` \| `test` |

---

## Project Status

**Current:** Scaffolding complete — monorepo structure, shared types, server skeleton, DB schema, frontend skeleton, Docker, CI.

**Up next:**
- Auth API (`POST /auth/register`, `POST /auth/login`, JWT middleware)
- Game & trading API (create game, join, place trades, portfolio)
- WebSocket server (real-time price broadcasting, leaderboard push)
- Frontend features (auth pages, game lobby, trading UI, TradingView charts)

See `docs/design.md` for the full feature roadmap and `docs/technical-decisions.md` for ADR entries.
