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
              src/: routes services providers db ws events
              workers (pending-orders settler, portfolio-snapshot)
              achievements observability (OpenTelemetry)
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
| Database (prod) | PostgreSQL (Docker path) or SQLite (single-host deployments — ADR-013) |
| Database (dev/test) | SQLite |
| Frontend framework | React 19 |
| Build tool | Vite |
| Charts | TradingView Lightweight Charts |
| UI components | ShadCN/UI + Tailwind CSS |
| Server state | React Query v5 (TanStack Query) |
| Client state | Zustand |
| WebSocket (client) | Native WebSocket API (no Socket.io) |
| Auth | JWT (`@fastify/jwt`) + argon2 passwords |
| Versioning | `@changesets/cli` — run locally, never in CI (ADR-014) |

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
- **Heartbeat** — `startWsHeartbeat` (`ws/heartbeat.ts`) pings every socket in both registries every
  `WS_HEARTBEAT_INTERVAL_MS` and terminates clients that missed the previous ping. Keep the interval
  under the shortest idle timeout on the deployed path (`proxy_read_timeout`), or intermediaries reap
  idle sockets and neither end is told.
- **Client backoff lives in one place** — `ReconnectController` (`frontend/src/lib/reconnect.ts`).
  Both socket hooks use it. Its attempt counter clears only after a connection has been open for 30s;
  clearing on `open` pins a socket that opens and immediately drops to the base delay forever
  (issue #27). Sockets stop after 10 consecutive attempts and publish `offline` on
  `useConnectionStore`, which turns the `LIVE` pill into a retry button.

---

## Authentication

- Access token: 15-minute JWT, `Authorization: Bearer <token>` header on REST requests
- Refresh token: 7-day token, HttpOnly cookie
- Both are signed with `JWT_SECRET` and separated **only** by a `type` claim (`access` / `refresh`).
  Mint them through `signAccessToken` / `signRefreshToken` in `plugins/jwt.ts` — never `app.jwt.sign`
  directly — so the claim cannot be forgotten. Every credential check requires a positive
  `type === 'access'`, so a token carrying no claim at all fails closed:
  `verifyAccessToken` (`plugins/jwt.ts`) behind both `authenticate` and `requireAdmin`, and the two
  WS upgrade handlers. Only `POST /auth/refresh` accepts a `refresh` token.
- `verifyAccessToken` also re-reads the `users` row on every request, so disabling or deleting an
  account takes effect on the *next* REST call rather than at the next token expiry. Live
  WebSockets are not re-checked — authorization there is still decided once at upgrade.
- Password hashing: argon2 via `@node-rs/argon2` (not bcrypt)
- JWT secret: any string ≥ 32 chars (enforced in production by `validateProductionEnv` in `env.ts`)
- WebSocket auth: `ws://host/games/:id/live?token=<access_token>`
- Login brute-force controls are deliberately two independent layers: the per-IP
  `@fastify/rate-limit` cap (5/min), and `FailedLoginTracker` in
  `services/failed-login.ts`, which counts failures per *username* so the control
  holds even when `request.ip` cannot be trusted. Don't remove one on the grounds
  that the other exists.

---

## Stock Price Provider

All price fetching goes through the `StockProvider` interface in `packages/server/src/providers/`. Do not call Yahoo Finance / Alpaca / Polygon directly from route handlers or services.

Default provider: Yahoo Finance (no key required).  
Switch via `STOCK_PROVIDER=alpaca` env var.

---

## Environment Variables

Core vars (see `.env.example` for the full, commented set):

```
DATABASE_URL=          # postgres://... or path/to/file.db or :memory:
JWT_SECRET=            # any string ≥ 32 chars (prod-enforced)
STOCK_PROVIDER=yahoo   # yahoo | alpaca | mock  (polygon is TODO, not yet wired in env.ts)
ALPACA_API_KEY_ID=     # required if STOCK_PROVIDER=alpaca (legacy ALPACA_API_KEY read as fallback)
ALPACA_API_SECRET_KEY= # required alongside the key ID
PORT=3000
CORS_ORIGIN=           # frontend URL (e.g. http://localhost:5173)
NODE_ENV=development   # development | production | test
TRUST_PROXY=loopback   # which hops may set X-Forwarded-For; `true` is refused in prod
```

`TRUST_PROXY` decides `request.ip`, which is the key every per-route rate limit is
bucketed on. Trusting every hop (`true`) makes that value client-controlled and lifts
every cap, so `validateProductionEnv` rejects it. Accepts `false`, a hop count, the
`loopback`/`linklocal`/`uniquelocal` presets, or a comma-separated IP/CIDR list; parsed
and validated at boot by `parseTrustProxy` in `env.ts`.

Additional vars rarely need touching (defined in `env.ts`, most also documented
in `.env.example`): the `MARKET_*` family (hours mode, status provider, extended
hours), the `STOCK_*_MS` resilience tunables (cache TTLs, rate-limit backoff,
stale-trade policy), the `LOGIN_*` family (per-account login throttle),
`PENDING_ORDERS_TICK_MS`, `PORTFOLIO_SNAPSHOT_INTERVAL_MS`,
`WS_HEARTBEAT_INTERVAL_MS`, and the `OTEL_*` family. `env.ts` is the source of truth for the full set.

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
# Note: `pnpm test` and `pnpm typecheck` build @markettrader/shared first.
# Running `pnpm --filter server test` directly can fail on stale shared types —
# run `pnpm build:shared` first, or just use the root script.
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

## Versioning and Releases

The app has **one version**. `@markettrader/server`, `/frontend`, and `/shared` are a
changesets `fixed` group, so they always carry the same number — `packages/server/package.json`
is the canonical copy. Managed entirely locally with `@changesets/cli`; CI has no release role.

**Versioning and deploying are independent.** Cutting a version does not deploy anything, and
deploying does not change a version. That means several deploys can carry the same version
number, which is why the build stamp includes a git SHA.

```bash
pnpm changeset            # describe a change; commit the generated .changeset/*.md
pnpm changeset version    # bump all three + write CHANGELOGs, consume the changesets
git commit -am "release: vX.Y.Z"
pnpm release:tag          # cuts a bare vX.Y.Z tag (not `changeset tag` — see ADR-014)
git push --follow-tags
```

- **Push before deploying.** Deployment builds from `origin`, so an unpushed version commit
  doesn't reach production.
- Never run `pnpm changeset publish` — nothing here goes to a registry.
- If `pnpm changeset version` dirties `pnpm-lock.yaml`, commit it: deployment installs with
  `--frozen-lockfile` and will fail otherwise. (`workspace:*` specifiers don't embed versions,
  so normally it doesn't.)

### The build stamp

`GET /version` → `{ version, commit, buildTime }`. Public and unauthenticated, like `/health`;
reachable at `/api/version` when the app is served behind a reverse proxy.
The shape is `VersionInfo` in `packages/shared`; the route handler is annotated with it so the
Zod schema and the shared contract can't drift.

The SPA has a matching page at **`/version`** (`pages/VersionPage.tsx`) — a public route outside
the protected block, so it stays reachable when the session is broken. It shows this bundle's
build next to the server's and names the difference when they disagree, which is the stale-cache
case behind the chunk-load error in `App.tsx`. Note `/version` on the SPA and `/api/version` on
the API are different things and do not collide.

Values are **injected at build time**, never read at runtime — `tsup` emits a flat `dist/` with
no `package.json`, and the Docker runner stage copies neither `package.json` nor `.git`.
`scripts/build-info.mjs` produces the `define` block consumed by `tsup.config.ts`,
`vite.config.ts`, and `vitest.config.ts`.

When adding a consumer, import `buildInfo` from `src/build-info.ts` rather than referencing the
`__APP_VERSION__` globals directly — the server module wraps them in a `typeof` guard because
`tsx watch` has no define step and a bare reference throws there. Current consumers:
`routes/version.ts`, `plugins/swagger.ts`, `observability/otel.ts`,
`observability/telemetry.ts`, and the frontend's `main.tsx` and
`observability/otel.ts`.

---

## Observability

Traces, metrics, and logs go out over OTLP to an OpenTelemetry Collector (ADR-015).
All of it is off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set, so a build with no collector
configured emits nothing and costs nothing. `docs/observability.md` is the metric catalogue
and the guide to what is instrumented.

The local Grafana LGTM stack and the provisioned dashboards are **not in this repo** — they
live with the deployment configuration, which is maintained separately. Point
`OTEL_EXPORTER_OTLP_ENDPOINT` at any OTLP/HTTP collector to see output.

Three things to know before touching this code:

- **Instrumentation is patch-free by design, not by accident.** `@fastify/otel` registers
  as a plugin and `instrumentation-undici` uses `diagnostics_channel`, so nothing needs to
  load before anything else. Adding an instrumentation that *does* patch modules would
  require a `node --import` bootstrap, and therefore a change to however the process is
  launched — which is deployment configuration, outside this repo. Prefer a manual span.
  ADR-015 has the full reasoning.
- **`@fastify/otel` must be registered before every route.** It wraps route definitions as
  they are declared, so anything registered above it is silently untraced.
- **Metric instruments are created lazily and must stay that way.** `metrics.getMeter()`
  binds to whatever provider exists at call time, and the metrics API — unlike traces —
  has no proxy that back-fills. Building them at module load makes every metric read zero
  forever. `tests/observability/telemetry.test.ts` guards this.

Adding a metric: define it in `observability/telemetry.ts` and record at the call site.
Keep symbols off metric attributes (unbounded cardinality) — they belong on spans.

The browser sends telemetry to a relative `/otel` path. In dev that is the `/otel` rule in
`packages/frontend/vite.config.ts`; in a deployed environment the reverse proxy needs an
equivalent route to the collector.

---

## Key Documents to Read

- `docs/technical-decisions.md` — before suggesting a library or architectural change
- `.changeset/README.md` — the release flow in short form
- `docs/design.md` — before adding any new entity, endpoint, or feature
- `docs/observability.md` — the metric catalogue and what is instrumented
- `docs/superpowers/specs/2026-05-08-markettrader-design.md` — the initial full spec

---

## Deployment

| Environment | Command |
|---|---|
| Local (SQLite) | `DATABASE_URL=./dev.db pnpm --filter server dev` |
| Local (Docker PG) | `docker-compose up` |
| Production | Docker: `Dockerfile.server` + Nginx for frontend static files |
| AWS | Single EC2 instance (t3.micro/small), Docker Compose, Nginx reverse proxy |

`docs/deployment.md` covers the Docker/Postgres path end to end.

**Production deployment configuration is maintained outside this repo.** Nothing here
provisions a host, installs a service manager, or configures a reverse proxy. Two consequences
worth remembering when changing code:

- `nginx.conf` in this repo is the **container** config, baked into `Dockerfile.frontend`. It
  is not what any non-Docker deployment serves.
- A change that needs a new proxy route, a new environment variable, or a different process
  launch does not ship by editing this repo alone. Call it out explicitly in your summary so
  the deployment side gets updated too.
