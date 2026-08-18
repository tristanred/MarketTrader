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
**Status:** Accepted — amended by [ADR-013](#adr-013-sqlite-as-a-supported-production-database-for-self-hosted-deployments) (2026-08-12), which permits SQLite in production for single-host deployments

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

---

## ADR-013: SQLite as a Supported Production Database for Self-Hosted Deployments

**Date:** 2026-08-12
**Status:** Accepted
**Amends:** ADR-005

**Decision:** SQLite is a supported production database for single-host, self-hosted deployments. PostgreSQL remains the choice for the AWS/multi-host path. `validateProductionEnv` no longer requires PostgreSQL in production; it enforces database *durability* instead.

**Context:** The intended deployment is a single host serving a long-running tournament for a few dozen players. ADR-005 assumed the production target was AWS with a managed or containerised PostgreSQL. On a single box with one operator, Postgres adds a second service to run, monitor, upgrade, and back up, in exchange for concurrency headroom this workload will not use.

**Alternatives considered:**
- **Keep the Postgres requirement, run Postgres on the VM** — correct but disproportionate: a second daemon plus `pg_dump` scheduling and role management, to serve a few dozen users whose writes are already serialised by the trade endpoint.
- **Add an `ALLOW_SQLITE_IN_PRODUCTION` opt-in flag** — rejected. It would preserve a check that no longer reflects reality and push the contradiction onto every operator as configuration.

**Reason:** At this scale SQLite in WAL mode is sufficient, and it makes the operational story markedly simpler: the database is one file, so a consistent backup is a single `VACUUM INTO` and a restore is a file swap. Point-in-time rollback — a stated requirement for a long-running competition — becomes trivial rather than a `pg_dump`/WAL-archiving exercise.

**What the validation change actually does:** The old check (`DATABASE_URL must start with postgres`) asserted a deployment *preference*, not a correctness property. It was replaced by `isDurableProductionDatabase` in `packages/server/src/env.ts`, which accepts a `postgres://` URL, a remote libsql URL, or an **absolute** path to a SQLite file, and rejects in-memory databases and CWD-relative paths. Those two rejected forms are the genuinely dangerous ones: `:memory:` discards every trade on restart, and a relative path resolves against `process.cwd()`, so launching from a different directory silently opens a fresh, empty database and migrates it into a working-looking app. Both fail *silently*, which is precisely what a boot guard exists to prevent.

**Consequences:**
- Single writer. Fine at this scale (WAL + `SQLITE_BUSY_TIMEOUT_MS` + app-level retries), but it is the ceiling if concurrent trading grows well beyond a few dozen active players.
- No network replication or read replicas. The database is only as available as the one host.
- Backups are file-level and must never be a plain `cp` — WAL mode means a naive copy can capture a torn state. A correct snapshot uses `VACUUM INTO` and verifies with `PRAGMA quick_check` before compressing. The backup tooling itself is deployment configuration and lives outside this repo.
- The schema must continue to be maintained in both `schema.sqlite.ts` and `schema.pg.ts`; this ADR does not retire the Postgres path.

---

## ADR-014: Changesets for Local Semver Versioning, Build-Injected into the Bundle

**Date:** 2026-08-15
**Status:** Accepted

**Decision:** The app carries a single semver version, managed locally with `@changesets/cli`. `server`, `frontend`, and `shared` are a changesets `fixed` group, so they never drift. The version, the short git SHA, and the build timestamp are injected into each bundle at build time and served publicly by `GET /version`.

**Context:** The app is deployed to a real host with real users and releases are getting more frequent, but nothing identified a build. Every package sat at `0.0.1` and had never moved, the repo had zero tags, the Swagger info block hardcoded `'0.0.1'`, and the only way to answer "what's deployed?" was to log into the host and read `git log`.

**Alternatives considered:**
- **Version in CI on merge** — rejected by requirement. Versioning is a deliberate act performed locally; CI has no release role in this project, and deploying deliberately doesn't touch versions.
- **Independent per-package versions** (changesets' default) — rejected. There is one deployable unit here, not three libraries. Three diverging numbers would raise "which one is the app version?" at exactly the moment you need a quick answer.
- **Read `package.json` at runtime** — rejected. `tsup` emits a flat `dist/index.js` with no `package.json` beside it, and `Dockerfile.server`'s runner stage copies neither `package.json` nor `.git`. It would work under a bare process manager and silently fail under Docker.
- **Report only the semver string** — rejected, see below.

**Why the payload carries a SHA:** versioning and deploying are independent, which is a requirement, not an accident. That means several deploys can legitimately carry the same version number, so the version alone does not identify a build. The short SHA does, and `buildTime` distinguishes rebuilds of the same commit.

**Why `fixed` rather than `linked`:** `linked` lets versions drift when packages are bumped separately. `fixed` guarantees all three always read the same, so "the app version" is unambiguous whichever package you look at. `@markettrader/tools-seed-game-history` is a dev-only tool and is `ignore`d.

**Why not `changeset tag`:** in a multi-package repo it emits `@markettrader/server@1.2.0`-style tags. Deploy tooling takes a git ref and constrains it to characters git actually allows in a ref, which excludes `@` — those tags would be rejected. `privatePackages.tag` is therefore `false`, and `scripts/tag-release.mjs` (`pnpm release:tag`) cuts a plain `vX.Y.Z` tag, which is what a deploy-by-tag needs.

**Consequences:**
- The workspace root's `package.json` version is not managed by changesets — the workspace root is not a changesets package. It is vestigial; `packages/server/package.json` is the canonical app version.
- Three `CHANGELOG.md` files are generated, one per fixed package. Accepted as the cost of a lockstep version.
- The version reaches production only by being committed and pushed: deployment builds from a fresh fetch of `origin`. A version bump that isn't pushed simply doesn't ship.
- `src/build-info.ts` needs a `typeof` guard on the injected globals. Dev runs under `tsx watch`, which has no define step, so a bare reference would throw a `ReferenceError` — dev reports `0.0.0-dev`. `vitest.config.ts` duplicates the tsup `define` block so tests exercise the real values instead of that fallback.
- `/version` is public, matching `/health`. It exposes a version and a commit SHA to anyone; `/health` and the Swagger UI at `/docs` are already public, so this adds little, and being able to check a deploy with one curl is the point.

**See also:** the "Versioning and Releases" section of `CLAUDE.md` for the operator flow.

---

## ADR-015: OpenTelemetry for Traces, Metrics, and Logs; Sentry Retired

**Date:** 2026-08-15
**Status:** Accepted
**Supersedes:** the Sentry integration introduced alongside ADR-014

**Decision:** The app emits OpenTelemetry traces, metrics, and logs over OTLP to an OpenTelemetry Collector, from both the server and the browser. Instrumentation is **patch-free by design** — no module monkey-patching anywhere. Sentry is removed. All telemetry is disabled unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set.

**Context:** The app runs a multi-month tournament on a single host (ADR-013), and the only observability was pino to stdout plus Sentry 5xx capture. There were no metrics and no traces, so questions like "why was that trade slow?", "how often is Yahoo rate-limiting us?", and "how many WebSocket clients are actually connected?" could only be answered by logging into the host and reading logs.

**Why patch-free is the load-bearing decision.** The standard OTel Node setup patches modules as they load, which requires the SDK to start before any instrumented module is imported. Under ESM that needs an `import-in-the-middle` loader hook, and under a **bundler** it needs a separate entry point launched with `node --import ...` — because esbuild hoists every external `import` to the top of the output file, so no import ordering inside `src/` can win. That would have meant editing the `dev` script, `Dockerfile.server`'s `CMD`, **and** however the deployed process is launched — which is deployment configuration maintained outside this repo, and therefore the change most likely to be forgotten. Forgetting it yields a production process that silently emits nothing.

None of it is necessary here, because every signal has a real registration point:

| Concern | Mechanism | Patching |
|---|---|---|
| HTTP server spans, route names, context extraction | `@fastify/otel`, registered as an ordinary Fastify plugin | no |
| Outbound HTTP spans | `@opentelemetry/instrumentation-undici` via `diagnostics_channel` | no |
| Log ↔ trace correlation | a pino `mixin` reading the active span | no |
| Logs → OTLP | a pino `transport` target | no |
| Domain metrics and spans | explicit calls in our own code | no |

The undici piece holds for a structural reason: every outbound call in this codebase is global `fetch` (`providers/alpaca.ts`, `providers/market-status/alpaca.ts`, and `yahoo-finance2` v3 internally). `fetch` is a global, not a module import, so no patching scheme *could* reach it — `diagnostics_channel` is the only mechanism, and it behaves identically under `tsx`, under tsup's bundle, and in Docker.

The cost is nil: `instrumentation-http` would only have added a lower-level span beneath the Fastify one, and `@fastify/otel` supersedes `instrumentation-fastify` outright. Route templates come out *better*, because the plugin reads Fastify's own routing table instead of inferring it.

**If a future instrumentation genuinely requires patching**, it will need the `--import` bootstrap described above, including the change to how the deployed process is launched. Weigh that against writing a manual span first.

**Alternatives considered:**
- **`@opentelemetry/auto-instrumentations-node`** — rejected. ~40 transitive packages instrumenting libraries this project does not use, right after a Dependabot cleanup, and it drags in the patching bootstrap for no coverage this app needs.
- **Prometheus `/metrics` scrape endpoint on the server** — rejected. Push-to-collector is one pipeline for all three signals; a scrape endpoint would be a second, separate path with its own exposure and firewall story.
- **Keeping Sentry alongside OTel** — rejected as duplicate error reporting with two systems to run. See the consequence below.

**Two implementation traps worth recording:**

1. **Metric instruments must be created lazily.** `metrics.getMeter()` returns whatever provider is registered *at call time*, and unlike the trace API there is no proxy that back-fills a real provider later. Because `observability/telemetry.ts` is imported through `app.ts` before `initTelemetry()` runs, building instruments at module load binds every one of them to the no-op meter for the life of the process — and every metric silently reads zero. `telemetry.ts` therefore defers construction to first use; `tests/observability/telemetry.test.ts` encodes the import order that broke.
2. **The pino OTLP transport runs in a worker thread** and inherits nothing from the in-process SDK, so the resource attributes must be passed to it explicitly. Otherwise every log record arrives tagged `service_name="unknown_service"` and cannot be joined to its trace.

**Consequences:**
- **No error alerting until a metrics backend and alert rules exist.** Errors are not lost — they stay in the process logs with trace ids attached — but nothing pages anyone. This is the accepted cost of retiring Sentry and the strongest reason to stand up a collector promptly.
- Retiring Sentry fixed a latent bug in the code it replaced: the old `attachSentry` hook read `reply.statusCode` in `onError`, where Fastify has not applied the status yet and it is still 200. Its `>= 400 ? … : 500` fallback therefore classified *every* thrown error as a 5xx, 4xx validation failures included. `attachErrorCapture` reads `err.statusCode` first.
- `/otel` is a public, unauthenticated write path into the telemetry store — the SPA posts to it before anyone signs in. Whatever proxy exposes it must cap body size and rate; without those caps it is a trivial flood vector. Note the failure mode when the route is missing is silent: browser telemetry 404s and the SPA keeps working.
- `vite.config.ts` now sets `envDir` to the workspace root so the single root `.env` feeds both packages. Only `VITE_`-prefixed variables reach the bundle, so server secrets in that file are not exposed.

**See also:** `docs/observability.md` for the metric catalogue and what is instrumented.
