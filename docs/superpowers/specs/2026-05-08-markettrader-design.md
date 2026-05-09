# MarketTrader — Design Spec

**Date:** 2026-05-08
**Status:** Approved
**Author:** Tristan Dubé-Lepage (via Claude Code brainstorming)

---

## Context

MarketTrader is a virtual stock trading tournament platform for groups of friends. Players join a "game" with virtual money and buy/sell real stocks (real prices, fake money). The closest reference is MarketWatch's virtual stock exchange, but with richer group/leaderboard mechanics.

The system is managed by Claude Code. Code must be clean, documented, and efficient. Two major subsystems: a REST + WebSocket API server, and a React frontend.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        pnpm Monorepo                            │
│                                                                 │
│  packages/shared      ← Shared TypeScript types (no runtime)    │
│  packages/server      ← Fastify API + WebSocket server          │
│  packages/frontend    ← React + Vite SPA                        │
└─────────────────────────────────────────────────────────────────┘

External:
  Stock Price Provider (pluggable — Yahoo Finance / Alpaca / Polygon)
  PostgreSQL (production) / SQLite (development + testing)
```

---

## Project Structure

```
MarketTrader/
├── packages/
│   ├── server/
│   │   ├── src/
│   │   │   ├── routes/         # REST route handlers
│   │   │   ├── ws/             # WebSocket channels
│   │   │   ├── db/             # Drizzle schema + migrations
│   │   │   ├── services/       # Business logic (trading, pricing)
│   │   │   ├── providers/      # Pluggable stock price providers
│   │   │   ├── plugins/        # Fastify plugins (auth, db, cors)
│   │   │   └── index.ts        # Entry point
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── frontend/
│   │   ├── src/
│   │   │   ├── components/     # Reusable UI components
│   │   │   ├── pages/          # Route-level page components
│   │   │   ├── hooks/          # Custom React hooks (WebSocket, query)
│   │   │   ├── stores/         # Zustand stores (client state)
│   │   │   ├── api/            # React Query hooks (server state)
│   │   │   └── main.tsx        # Entry point
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── shared/
│       ├── src/
│       │   ├── types/          # API request/response types
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
├── docs/
│   ├── technical-decisions.md  # ADR log
│   ├── design.md               # Evolving design doc (this file's living companion)
│   └── superpowers/specs/      # Brainstorming specs
├── .github/
│   └── workflows/
│       └── ci.yml              # Lint + typecheck + test
├── docker-compose.yml          # Local dev stack (PostgreSQL)
├── Dockerfile.server           # Server production image
├── CLAUDE.md                   # Project context for Claude Code
├── pnpm-workspace.yaml
└── package.json                # Root workspace (scripts, dev tooling)
```

---

## Technology Stack

### Server (`packages/server`)

| Layer | Choice | Rationale |
|---|---|---|
| Runtime | Node.js + TypeScript | Stable, well-supported, no Bun lock-in |
| Framework | **Fastify v5** | TypeScript-first, battle-tested WebSocket plugin, best performance/simplicity ratio |
| WebSocket | `@fastify/websocket` | Route-level WS with the same Fastify plugin lifecycle |
| Auth | JWT via `@fastify/jwt` | Stateless, fits a small multi-server setup |
| Passwords | `argon2` | Secure password hashing |
| ORM | **Drizzle ORM** | Dual-dialect (PostgreSQL prod, SQLite dev) from one schema |
| Validation | Zod + `fastify-zod-openapi` | Type-safe schemas that double as OpenAPI docs |
| Logging | Pino (Fastify built-in) | Structured JSON logging |

### Frontend (`packages/frontend`)

| Layer | Choice | Rationale |
|---|---|---|
| Framework | **React 19** | Largest fintech ecosystem, Claude Code familiar |
| Build | **Vite** | Sub-50ms HMR, fast production builds |
| Charts | **TradingView Lightweight Charts** | Industry-standard for financial dashboards, canvas-based |
| UI | **ShadCN/UI + Tailwind CSS** | Copy-paste components, fully customizable, no lock-in |
| Server state | **React Query v5** | REST caching + WebSocket subscriptions |
| Client state | **Zustand** | Minimal footprint for portfolio/UI state |
| WebSocket | Native WebSocket API (or `ws` client) | No Socket.io overhead; server uses plain WS |

### Shared (`packages/shared`)

- TypeScript interfaces only — no runtime code
- API request/response types shared between server and frontend
- Prevents API contract drift between packages

### Database

| Environment | Engine | Connection |
|---|---|---|
| Production | PostgreSQL | Drizzle with `drizzle-orm/postgres-js` |
| Development | SQLite | Drizzle with `drizzle-orm/better-sqlite3` |
| Testing | SQLite (in-memory) | Same driver, `DATABASE_URL=:memory:` |

Driver selection is done at server startup via `DATABASE_URL` prefix (`postgres://` → PostgreSQL, otherwise → SQLite).

### Stock Price Provider

Abstracted behind a `StockProvider` interface:
```typescript
interface StockProvider {
  getQuote(symbol: string): Promise<StockQuote>;
  streamQuotes(symbols: string[], onUpdate: (q: StockQuote) => void): () => void;
}
```

Default implementation: Yahoo Finance (unofficial, no key required).
Swap to Alpaca or Polygon by setting `STOCK_PROVIDER=alpaca` + API key env var.

---

## Data Model

```
User
  id            UUID (PK)
  username      TEXT UNIQUE
  passwordHash  TEXT
  createdAt     TIMESTAMP

Game
  id            UUID (PK)
  name          TEXT
  startDate     TIMESTAMP
  endDate       TIMESTAMP
  startingBalance  DECIMAL (default 100,000)
  status        ENUM (pending | active | ended)
  createdBy     UUID → User.id
  createdAt     TIMESTAMP

GamePlayer  (user ↔ game pivot)
  id            UUID (PK)
  gameId        UUID → Game.id
  userId        UUID → User.id
  cashBalance   DECIMAL (starts at game.startingBalance)
  joinedAt      TIMESTAMP
  UNIQUE (gameId, userId)

Portfolio   (holdings per player per game)
  id            UUID (PK)
  gamePlayerId  UUID → GamePlayer.id
  symbol        TEXT
  quantity      INTEGER
  avgCostBasis  DECIMAL
  UNIQUE (gamePlayerId, symbol)

Trade
  id            UUID (PK)
  gamePlayerId  UUID → GamePlayer.id
  symbol        TEXT
  direction     ENUM (buy | sell)
  quantity      INTEGER
  price         DECIMAL  (price at execution time)
  executedAt    TIMESTAMP

StockPriceCache  (write-through cache, short TTL)
  symbol        TEXT (PK)
  price         DECIMAL
  change        DECIMAL
  changePercent DECIMAL
  fetchedAt     TIMESTAMP
```

---

## API Design

### Authentication

```
POST /auth/register   body: { username, password }   → { token, user }
POST /auth/login      body: { username, password }   → { token, user }
```

### Games

```
GET  /games                   → Game[]  (games user is in)
POST /games                   body: { name, startDate, endDate, startingBalance }
POST /games/:id/join          → joins caller as a player
GET  /games/:id               → Game + leaderboard snapshot
```

### Trading

```
GET  /games/:id/portfolio     → Portfolio[] for caller
POST /games/:id/trades        body: { symbol, direction, quantity }
GET  /games/:id/trades        → Trade[] for caller (history)
```

### Stocks

```
GET  /stocks/:symbol          → StockQuote (cached, max 30s stale)
GET  /stocks/search?q=<term>  → StockSearchResult[]
```

---

## WebSocket Protocol

**Connection:** `ws://<host>/games/:id/live`
**Auth:** JWT passed as `?token=<jwt>` query param on connect.

### Server → Client events

```jsonc
// Batched every ~5 seconds for active game symbols
{ "event": "price_update", "data": [{ "symbol": "AAPL", "price": 182.50, "change": 1.2, "changePercent": 0.66 }] }

// Broadcast when any player executes a trade
{ "event": "trade_executed", "data": { "playerId": "...", "symbol": "TSLA", "direction": "buy", "quantity": 10, "price": 220.00 } }

// Broadcast after each trade or price tick, throttled to ≤1/sec
{ "event": "leaderboard_update", "data": [{ "playerId": "...", "username": "alice", "totalValue": 103500 }] }
```

### Client → Server events

```jsonc
// Subscribe to price updates for specific symbols
{ "event": "subscribe", "data": { "symbols": ["AAPL", "TSLA"] } }
```

---

## Authentication Flow

1. Client sends `POST /auth/login` → server returns JWT (15 min expiry) + refresh token (7 days, stored in HttpOnly cookie)
2. All REST requests include `Authorization: Bearer <jwt>`
3. WebSocket connects with `?token=<jwt>` in URL
4. Server validates JWT on WS upgrade; rejects with 401 if invalid/expired

---

## Deployment

| Target | Method |
|---|---|
| Local dev | `docker-compose up` (PostgreSQL) or `DATABASE_URL=./dev.db` (SQLite) |
| Docker | `Dockerfile.server` for server, Nginx serving built frontend |
| AWS | Single EC2 t3.micro or t3.small, Docker Compose, Nginx reverse proxy |

Environment variables:
```
DATABASE_URL=           # postgres://... or ./path/to/file.db
JWT_SECRET=             # random 64-char secret
STOCK_PROVIDER=yahoo    # yahoo | alpaca | polygon
ALPACA_API_KEY=         # (if provider=alpaca)
PORT=3000
CORS_ORIGIN=            # frontend URL
```

---

## Testing Strategy

| Level | Tool | What it covers |
|---|---|---|
| Unit | Vitest | Service logic (trade execution, P&L calculation) |
| Integration | Vitest + SQLite in-memory | Route handlers, DB queries |
| E2E | Playwright | Full user flows (register → join game → buy stock → see leaderboard) |
| Types | `tsc --noEmit` | TypeScript correctness across all packages |

---

## Constraints & Non-Goals (MVP)

**In scope:**
- Game creation and joining
- Buy/sell market orders (instant fill at current price)
- Real-time leaderboard via WebSocket
- Live price updates for held symbols

**Out of scope (MVP):**
- Limit/stop orders
- Short selling
- Dividends, splits
- Mobile app (web only)
- Social features (comments, reactions)
- Admin moderation endpoints
- Game invite codes (all registered users can join any game by ID)

---

## Documents

- `docs/technical-decisions.md` — ADR log of every major choice with reasoning
- `docs/design.md` — Living design doc (update as features are added)
- `CLAUDE.md` — Instructions and context for Claude Code sessions
