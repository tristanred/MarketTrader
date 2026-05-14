# MarketTrader — Claude Code Context

This file is the primary context document for Claude Code sessions. Read it at the start of every session before touching code.

---

## What This Project Is

MarketTrader is a virtual stock trading tournament platform. Groups of friends create a "game", start with equal virtual cash, and compete to build the most valuable portfolio by trading real stocks at real market prices. A real-time leaderboard tracks rankings throughout the game.

---

## Project Structure

```
packages/
  server/     ← Fastify REST API + WebSocket server (Node.js + TypeScript)
  frontend/   ← React 19 + Vite SPA
  shared/     ← TypeScript types only — API contracts shared between server and frontend
docs/
  technical-decisions.md  ← ADR log — read before suggesting alternative tech
  design.md               ← Evolving feature/entity design — update when adding features
  superpowers/specs/      ← Brainstorming session specs
CLAUDE.md                 ← This file
```

---

## Technology Choices — Do Not Change Without ADR

These were chosen deliberately (see `docs/technical-decisions.md` for full rationale):

| Layer | Choice |
|---|---|
| Package manager | pnpm (workspaces) |
| Server framework | Fastify v5 |
| WebSocket (server) | `@fastify/websocket` |
| ORM | Drizzle ORM |
| Database (prod) | PostgreSQL |
| Database (dev/test) | SQLite |
| Frontend framework | React 19 |
| Build tool | Vite |
| Charts | TradingView Lightweight Charts |
| UI components | ShadCN/UI + Tailwind CSS |
| Server state | React Query v5 (TanStack Query) |
| Client state | Zustand |
| WebSocket (client) | Native WebSocket API (no Socket.io) |
| Auth | JWT (`@fastify/jwt`) + argon2 passwords |

If a library version is outdated or a better alternative emerges, open an ADR entry in `docs/technical-decisions.md` rather than silently swapping.

---

## Code Style and Conventions

- **TypeScript strict mode** everywhere (`"strict": true` in all tsconfigs)
- **No `any`** — use `unknown` and narrow, or define proper types in `packages/shared`
- **No comments that explain what** — only comments that explain *why* (a non-obvious constraint, a workaround, a subtle invariant)
- **No docstrings** on obvious functions — the name should be enough
- **Error handling at boundaries** — validate at route entry (Zod), not inside services
- **No half-finished implementations** — if a feature is incomplete, mark it with `// TODO(feature-name):` and note it in `docs/design.md`

---

## Documentation Conventions

Every exported function, class, and interface must have a JSDoc comment unless the name already makes the purpose completely unambiguous (a trivial getter, a re-export, etc.).

**What to document:**

- Exported functions and classes in `packages/server/src/services/`, `providers/`, and `routes/` — describe what the function does, non-obvious parameters, and what errors it can throw.
- Exported interfaces and types in `packages/shared/src/types/` — describe the purpose of the type and any fields whose meaning is not self-evident from the name (units, constraints, nullable semantics).
- Drizzle table definitions in `packages/server/src/db/schema.sqlite.ts` and `schema.pg.ts` — one comment per table describing its role in the data model.

**Rules:**

- Keep JSDoc comments to 1–4 lines. If you need more, the function is probably doing too much.
- Use `{@link SomeName}` to cross-reference related types or functions where it adds real value.
- Inline comments (`//`) are for non-obvious *why*: a workaround, a subtle invariant, a surprising constraint. Not for narrating what the next line does.
- When you add or modify a function/type, update its JSDoc in the same commit.

---

## Database Rules

- **Schema lives in `packages/server/src/db/schema.sqlite.ts` and `schema.pg.ts`** — one file per dialect, kept in sync by hand
- **Never write raw SQL** — use Drizzle query builder
- **Migrations**: `pnpm --filter server db:generate` (create), `db:migrate` (apply), `db:studio` (inspect). Never hand-edit migration files.
- Driver selection at startup:
  ```typescript
  DATABASE_URL starts with "postgres" → postgres-js driver
  otherwise                           → better-sqlite3 driver
  ```
- Test databases use `DATABASE_URL=:memory:` (SQLite in-memory)

---

## WebSocket Conventions

- **Register `@fastify/websocket` before all routes**
- **Wrap every WS message handler in try/catch** — errors do not propagate to Fastify's error handler
- **Batch price updates** — never push a message for every individual price tick; batch at 5-second intervals
- **Clean up disconnected clients** — always remove sockets from broadcast lists on `close` and `error`
- **Auth on upgrade** — validate JWT from `?token=` query param at WebSocket connection time, not per-message

---

## Authentication

- Access token: 15-minute JWT, `Authorization: Bearer <token>` header on REST requests
- Refresh token: 7-day token, HttpOnly cookie
- Password hashing: argon2 via `@node-rs/argon2` (not bcrypt)
- WebSocket auth: `ws://host/games/:id/live?token=<access_token>`

---

## Stock Price Provider

All price fetching goes through the `StockProvider` interface in `packages/server/src/providers/`. Do not call Yahoo Finance / Alpaca / Polygon directly from route handlers or services.

Default provider: Yahoo Finance (no key required).  
Switch via `STOCK_PROVIDER=alpaca` env var.

---

## Environment Variables

```
DATABASE_URL=         # postgres://... or path/to/file.db or :memory:
JWT_SECRET=           # random 64-char hex string
STOCK_PROVIDER=yahoo  # yahoo | alpaca  (polygon is TODO, not yet wired in env.ts)
ALPACA_API_KEY=       # required if STOCK_PROVIDER=alpaca
PORT=3000
CORS_ORIGIN=          # frontend URL (e.g. http://localhost:5173)
```

---

## Running Locally

```bash
# Start PostgreSQL (optional — use SQLite if you don't want Docker)
docker-compose up -d db

# Install all packages
pnpm install

# Start everything (server + frontend in parallel).
# Runs scripts/bootstrap-dev.mjs first — auto-creates .env from .env.example
# and fills in a random JWT_SECRET if the placeholder is present.
pnpm dev

# Or run a single package
pnpm --filter server dev
pnpm --filter frontend dev

# Tests / typecheck / lint (root-level, runs across all packages)
pnpm test
pnpm typecheck
pnpm lint

# Frontend Playwright e2e
pnpm --filter frontend e2e

# Drizzle
pnpm --filter server db:generate   # generate migration from schema changes
pnpm --filter server db:migrate    # apply migrations
pnpm --filter server db:studio     # open Drizzle Studio
```

---

## Business Rules (do not violate)

1. Trades execute immediately at the last fetched price (no order book)
2. No short selling — players can only sell shares they own
3. No fractional shares — quantity must be a positive integer ≥ 1
4. Buy requires `quantity × price ≤ cashBalance`
5. Trades only accepted when `game.status === 'active'`
6. Portfolio value = `cashBalance + Σ(quantity × currentPrice)`
7. Leaderboard rank = descending portfolio value

---

## Key Documents to Read

- `docs/technical-decisions.md` — before suggesting a library or architectural change
- `docs/design.md` — before adding any new entity, endpoint, or feature
- `docs/superpowers/specs/2026-05-08-markettrader-design.md` — the initial full spec

---

## Deployment

| Environment | Command |
|---|---|
| Local (SQLite) | `DATABASE_URL=./dev.db pnpm --filter server dev` |
| Local (Docker PG) | `docker-compose up` |
| Production | Docker: `Dockerfile.server` + Nginx for frontend static files |
| AWS | Single EC2 instance (t3.micro/small), Docker Compose, Nginx reverse proxy |
