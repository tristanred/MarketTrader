# Technical Decisions — MarketTrader

This document records significant architectural and technology choices using an ADR-style (Architecture Decision Record) format. Each entry captures the decision, the alternatives considered, and the reason for the choice.

---

## ADR-001: Monorepo with pnpm Workspaces

**Date:** 2026-05-08  
**Status:** Accepted

**Decision:** Use a single Git repository with three pnpm workspace packages: `server`, `frontend`, and `shared`.

**Alternatives:**
- Separate repositories for server and frontend
- Flat folder structure without workspace packages

**Reason:** A monorepo allows the `shared` package to enforce TypeScript type contracts between server and frontend without publishing to npm. A single repo also simplifies CI and developer onboarding. pnpm workspaces were chosen over npm/yarn because pnpm is already the specified package manager and its workspace implementation has the best disk usage via hard links.

---

## ADR-002: Fastify as the HTTP/WebSocket Server Framework

**Date:** 2026-05-08  
**Status:** Accepted

**Decision:** Use Fastify v5 for the server package.

**Alternatives considered:**
- NestJS — ruled out as over-engineered for a solo/small-team project; DI overhead, slower cold starts, heavy boilerplate
- Hono — excellent TypeScript inference but `@hono/node-ws` is newer and less battle-tested than Fastify's WebSocket plugin
- Express — not TypeScript-native; no schema-based validation; no longer recommended for new projects

**Reason:** Fastify provides the best balance of performance, TypeScript support, mature WebSocket integration via `@fastify/websocket`, and ecosystem simplicity. Its plugin model (auth, JWT, CORS, rate-limiting) is well-documented and composable without framework magic.

**Key considerations for real-time use:**
- WebSocket plugin must be registered before routes
- Error handlers don't catch WebSocket errors — manual try/catch in all message handlers
- Price updates must be batched (100–500ms intervals) to avoid flooding clients

---

## ADR-003: React 19 + Vite as the Frontend Stack

**Date:** 2026-05-08  
**Status:** Accepted

**Decision:** React 19 with Vite as the build tool.

**Alternatives considered:**
- Vue 3 + Vite — better built-in reactivity for streams, but smaller financial charting ecosystem and fewer examples for trading UIs
- SvelteKit — most elegant reactivity model, but charting library maturity is behind React

**Reason:** React has the strongest ecosystem for financial dashboard UIs. TradingView Lightweight Charts, the industry-standard charting library, has first-class React examples and community wrappers. The React + Vite combination gives sub-50ms HMR. React 19 concurrent rendering handles high-frequency WebSocket updates gracefully via automatic batching.

---

## ADR-004: Drizzle ORM for Dual-Dialect Database Support

**Date:** 2026-05-08  
**Status:** Accepted

**Decision:** Use Drizzle ORM for all database access.

**Alternatives considered:**
- Prisma — ruled out because Prisma migrations are dialect-specific; switching from PostgreSQL to SQLite requires discarding migration history and re-running from scratch
- TypeORM — heavier, less TypeScript-idiomatic than Drizzle

**Reason:** Drizzle allows the same schema and query code to run against both PostgreSQL (production) and SQLite (development and testing) by switching the driver at startup based on `DATABASE_URL`. The schema is defined once in TypeScript; `drizzle-kit` generates per-dialect migrations. This makes the dev → production workflow seamless without maintaining parallel schemas.

**Driver selection pattern:**
```typescript
const db = DATABASE_URL.startsWith('postgres')
  ? drizzle(postgres(DATABASE_URL))
  : drizzle(new Database(DATABASE_URL));
```

---

## ADR-005: PostgreSQL for Production, SQLite for Development/Testing

**Date:** 2026-05-08  
**Status:** Accepted

**Decision:** PostgreSQL is the production database. SQLite is used locally and in CI test runs.

**Reason:** PostgreSQL provides the transactional guarantees needed for financial data (concurrent trade execution, balance updates) and runs well on a $5–10/month AWS instance or as a Docker container. SQLite eliminates external database setup for local development and allows fast in-memory databases for test runs (`DATABASE_URL=:memory:`).

**Concurrency note:** File-based SQLite connections open in WAL mode so readers and the single writer don't block each other — this is what lets the API and its workers keep serving while a long write job (e.g. `tools/seed-game-history`) runs against the same file. WAL is stored in the DB-file header, so it persists across every connection libsql lazily spawns. Writer-vs-writer contention is handled separately by `PRAGMA busy_timeout` (`SQLITE_BUSY_TIMEOUT_MS`): libsql resets it to 0 on each new connection and retrying a failed `BEGIN IMMEDIATE` on the same connection does not recover, so the seed tool re-applies the PRAGMA immediately before each write (see `db-busy.ts`) to make the lock *wait* rather than fail. The live API's own writes are not yet wrapped this way (follow-up). This is connection tuning, not a driver change, so it stays under this ADR.

---

## ADR-006: Pluggable Stock Price Provider

**Date:** 2026-05-08  
**Status:** Accepted

**Decision:** All stock price fetching is done through a `StockProvider` interface, not directly from any specific API.

**Default implementation:** Yahoo Finance (unofficial, no API key required).

**Alternatives available:** Alpaca Markets (official, free tier), Polygon.io (official, free tier has 15-min delay).

**Reason:** No single free stock data provider is ideal for all situations. Yahoo Finance has no key requirement (good for quick start) but is unofficial. Alpaca has a free tier with WebSocket streaming. The interface abstraction allows switching providers by changing an environment variable, preventing lock-in.

---

## ADR-007: JWT for Authentication

**Date:** 2026-05-08  
**Status:** Accepted

**Decision:** Username/password authentication with JWT access tokens and refresh tokens.

**Access token:** 15-minute expiry, sent as `Authorization: Bearer` header.  
**Refresh token:** 7-day expiry, stored in HttpOnly cookie.  
**Password hashing:** argon2 (preferred over bcrypt; more resistant to GPU attacks).

**Reason:** Simple username/password auth eliminates OAuth provider dependencies and is straightforward to implement and maintain. JWTs are stateless, which is important for WebSocket authentication (the token is passed as a query param on connection). Refresh tokens prevent users from being logged out every 15 minutes without compromising short-lived access token security.

---

## ADR-008: TradingView Lightweight Charts for Financial Visualization

**Date:** 2026-05-08  
**Status:** Accepted

**Decision:** Use TradingView Lightweight Charts as the primary charting library.

**Alternatives considered:**
- Recharts — React-native but SVG-based, degrades under high-frequency updates
- ApexCharts — cross-framework but heavier and less optimized for financial OHLC data

**Reason:** TradingView Lightweight Charts is the industry standard for web-based financial charts. It is canvas-based (high FPS, handles real-time tick data), has first-class TypeScript definitions, official React integration examples, and an `update()` API designed for streaming data.

---

## ADR-009: ShadCN/UI + Tailwind CSS for UI Components

**Date:** 2026-05-08  
**Status:** Accepted

**Decision:** Use ShadCN/UI components with Tailwind CSS for all UI elements.

**Alternatives considered:**
- Ant Design — purpose-built for data apps but opinionated styling is hard to override
- Material UI — largest install base but heavy, Google-aesthetic by default

**Reason:** ShadCN/UI provides copy-paste components with no runtime library dependency. Components live in the project and can be customized freely. Tailwind CSS enables rapid layout work without leaving TypeScript/JSX. This combination is easy for Claude Code to read and modify because there is no hidden component magic.

---

## ADR-010: React Query + Zustand for State Management

**Date:** 2026-05-08  
**Status:** Accepted

**Decision:** React Query (TanStack Query v5) for server state; Zustand for client-only state.

**Reason:** React Query handles REST request caching, refetching, loading/error states, and can be wired to WebSocket updates via `queryClient.setQueryData`. Zustand manages lightweight client-only state (current game context, UI preferences) with minimal boilerplate. This separation keeps server-originated state (prices, portfolios, leaderboards) clearly distinct from client-side UI state.

---

## ADR-011: Native WebSocket (no Socket.io)

**Date:** 2026-05-08  
**Status:** Accepted

**Decision:** Use the browser's native WebSocket API on the frontend; `@fastify/websocket` (which uses the `ws` library) on the server.

**Rationale for rejecting Socket.io:** Socket.io adds ~30KB client bundle, HTTP long-polling fallback (unnecessary for modern browsers), room/namespace concepts that add complexity not needed here. The protocol is simpler with plain WebSocket + JSON messages with an `event` field.

---

## ADR-012: Docker Compose for Local Development

**Date:** 2026-05-08  
**Status:** Accepted

**Decision:** Provide `docker-compose.yml` for local development (PostgreSQL + server). Frontend runs natively via `pnpm dev`.

**Reason:** Docker Compose gives developers a clean PostgreSQL instance without installing it locally. The frontend is excluded from Docker in dev mode to keep Vite HMR working natively. Production uses `Dockerfile.server` for the server and an Nginx container serving the built frontend static files.
