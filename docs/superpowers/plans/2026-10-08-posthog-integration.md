# PostHog integration — fix-up and completion plan

Branch: `posthog`. Started 2026-10-08. The PostHog wizard installed `posthog-js` in the
frontend and a one-off OTLP logger on the server. A review found the install breaks the
repo, can't reach PostHog in production, and has no server-side analytics. This file is
the resumable todo list: tick boxes as you go, and read "Decisions" before changing course.

PostHog project: **Market Trader** (id `648133`, US cloud, `https://us.i.posthog.com`).
At review time `ingested_event: false`: nothing had ever arrived.

## Decisions (settled — don't re-litigate)

- **Missing keys = silently off.** This matches `OTEL_EXPORTER_OTLP_ENDPOINT`. It never throws, in
  dev or anywhere else. Tests never initialise PostHog.
- **Env vars.**
  - Server: `POSTHOG_KEY` and `POSTHOG_HOST`, shared by `posthog-node` and log export. They
    replace the wizard's `POSTHOG_LOGS_KEY` and `POSTHOG_LOGS_HOST`.
  - Frontend: `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST`, and an optional `VITE_POSTHOG_UI_HOST`.
- **Server logs → PostHog** go through a second `pino-opentelemetry-transport` target, aimed at
  `${POSTHOG_HOST}/i/v1/logs` with a Bearer token.
  - It is independent of the collector target, so both, either, or neither can be on.
  - Every pino log line goes, not just two hand-written records.
  - The wizard's `observability/posthog-logs.ts` is deleted, along with the two deps it alone needed
    (`@opentelemetry/api-logs` and `@opentelemetry/sdk-logs` in the server package).
- **Browser logs → PostHog** via posthog-js's `logs` option and `posthog.logger`. The wizard
  already set this up; keep it.
- **Browser exceptions are owned by PostHog**: error tracking, linked to replay and person.
  - The OTel browser SDK keeps traces and Web Vitals.
  - It keeps its uncaught-error log capture *only when PostHog is disabled*, so errors still go
    somewhere.
- **Server 5xx** keep their OTel span status, because that is needed for trace filtering. They are
  *also* sent to PostHog error tracking via `posthog-node` `captureException`, carrying the
  request user as `distinctId`.
- **Business events are captured server-side.** One analytics subscriber on the domain
  `EventBus` sends them through `posthog-node`, with `distinctId = users.id` (the same id the
  frontend `identify`s).
  - Only *true* duplicates are removed from the client: `game_created` and `game_joined`.
  - `trade_order_submitted` stays on the client. It records an order being *placed*, and
    `trade_executed` records a *fill*. A limit or GTC order may fill hours later in the settler,
    or never.
  - Client-only UX events stay client-side: watchlist actions, login, register.
- **Every event carries `environment`** (`import.meta.env.MODE` / `NODE_ENV`). Dev and prod share
  one PostHog project, and this property is what filters dev traffic out.
- **`posthogEnabled` lives in a module that does not import posthog-js**
  (`lib/posthogConfig.ts`). That way `observability/otel.ts` can read it without pulling the SDK
  into the OTel chunk.
- **Log volume.** PostHog log export gets its own level floor, `POSTHOG_LOG_LEVEL_MIN`, defaulting
  to `warn`. PostHog Logs is billed by volume, and Fastify writes two info lines per request.
- **No PostHog Group analytics** (each game as a group). It is a paid add-on. Revisit later.
- **Same-origin reverse proxy at `/relay`.** The name is deliberately not "analytics" or
  "posthog", which ad blockers match.
  - `/relay/static/*` and `/relay/array/*` → `us-assets.i.posthog.com`; everything else →
    `us.i.posthog.com`.
  - The CSP then stays `'self'`.
  - Dev mirror: `vite.config.ts`, like `/otel`. Container mirror: `nginx.conf`. Production:
    deployment repo.
- **Session reset only on real identity changes.**
  - `clear()` no longer calls `posthog.reset()`, because a refresh failure is not a logout.
  - Explicit logout resets.
  - `setSession` resets first if PostHog is already identified as a *different* user.
- **No commits** unless the user asks.

---

## Status (2026-10-08, end of session 1)

Phases 1–6 done and verified. `pnpm test` (1,103 tests), `pnpm typecheck` and `pnpm lint` all pass
with no bypass flags, and the frontend suite also passes with no PostHog env.

Verified live against project 648133 via `pnpm dev`:
- A `$pageview` arrived through `/relay`, tagged `environment=development`.
- The frontend `frontend started` log arrived.
- Server pino logs arrived as service `markettrader-server`, with `POSTHOG_LOG_LEVEL_MIN=info`
  set for the check.

Not verified:
- `nginx -t` on the container `nginx.conf`, because Docker wasn't running.
- A live server-side `capture`. Its wiring is covered by `tests/observability/analytics.test.ts`,
  and logs prove the key and host are good.

Deviations from the plan:
- posthog-node is gated on `NODE_ENV=test` only, not on `:memory:` URLs too. Analytics doesn't
  need the seed's determinism.
- The settler and admin emits pass `origin` explicitly. `player.joined` gained `joinSource`.

Junk data: 17 `$pageview` events from `http://localhost:3000/` at 21:32 that day came from the
wizard's code running inside Vitest (jsdom's default URL). Filter or delete them in PostHog.

## Phase 1 — Unbreak the repo

- [x] **1.0 Bundle measurement first** (it decides the call-site shape for 3.1, 3.4 and 4.6).
      See 3.5.

- [x] **1.1 `pnpm-workspace.yaml`.** Replace `core-js: set this to true or false` with
      `core-js: false` and a why-comment: its postinstall only prints a funding banner. Plain
      `pnpm test` must then run with no bypass flag.
- [x] **1.2 Frontend `lib/posthog.ts`.** Remove the DEV `throw`. Compute `posthogEnabled` as
      `Boolean(key && host) && import.meta.env.MODE !== 'test'`.
- [x] **1.3 Server.** Remove the dev `throw`, which goes away with posthog-logs.ts in 2.1.
- [x] **1.4 `.env.example`.** Empty values, with comments. Add the server's `POSTHOG_KEY` and
      `POSTHOG_HOST`, plus the source-map vars from 3.2, all empty.
- [x] **1.5 `vite-env.d.ts`.** Declare `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST` and
      `VITE_POSTHOG_UI_HOST` as optional strings.
- [x] **1.6 e2e.** Check how Playwright starts the frontend and server. e2e runs aren't in test
      mode, so make sure the PostHog keys are empty there, or they send events to the real project.
- [x] **1.7 Local `.env`.** Rename the user's `POSTHOG_LOGS_*` to `POSTHOG_*` and, in Phase 5, set
      `VITE_POSTHOG_HOST=/relay`. Edit in place without printing the values, and tell the user.
- [x] **1.8 Verify.** The frontend suite passes with `VITE_POSTHOG_KEY= VITE_POSTHOG_HOST=`. The
      server starts in dev with no PostHog vars.

## Phase 2 — Logs to PostHog

- [x] **2.1 Remove the wizard logger.** Delete `server/src/observability/posthog-logs.ts` and its
      calls in `index.ts`. Drop `@opentelemetry/api-logs` and `@opentelemetry/sdk-logs` from
      server deps, after checking that nothing else imports them.
- [x] **2.2 PostHog log target in `index.ts`.** Generalise `withOtlpTransport` so it adds 0–2
      `pino-opentelemetry-transport` targets:
      - The collector target, as today.
      - A PostHog target, configured through `logRecordProcessorOptions` with an http exporter, the
        `${POSTHOG_HOST}/i/v1/logs` url, and an `Authorization: Bearer` header.
      - Both targets carry the same `resourceAttributes`.
      - **First** read `node_modules/pino-opentelemetry-transport/lib/`. If it calls
        `logs.setGlobalLoggerProvider`, two targets in one pino worker would collide; in that
        case use a single target with an array of `logRecordProcessorOptions`, passing the
        collector URL explicitly. That approach shares one level floor, so pick the target design
        that allows `POSTHOG_LOG_LEVEL_MIN`.
      - Redaction already applies before transports.
      - The URL helper lives next to the env, e.g. `posthogLogsEnabled` in `env.ts`.
- [x] **2.3 Server env.** Add `POSTHOG_KEY` and `POSTHOG_HOST` to `env.ts` with JSDoc. Remove
      `POSTHOG_LOGS_*`, and export a `posthogEnabled` flag.
- [x] **2.4 Test.** The transport-options builder (pure function) yields the right targets for
      each combination of collector and PostHog on or off.
- [x] **2.5 Frontend logs.** Keep the `logs` init option. Keep the `frontend started` record in
      `main.tsx`, guarded by `posthogEnabled`.

## Phase 3 — Frontend correctness & design

- [x] **3.1 Report caught errors.** Add `componentDidCatch(error, info)` to `RouteErrorBoundary`
      (`App.tsx`), calling `posthog.captureException(error, { component_stack })` when enabled.
      Add a test with posthog mocked.
- [x] **3.2 Source maps.** Add `@posthog/rollup-plugin` to `vite.config.ts`.
      - Active only when `POSTHOG_PERSONAL_API_KEY` and `POSTHOG_PROJECT_ID` are set at build time,
        so dev and CI are unaffected.
      - Use `releaseName: 'markettrader-frontend'`, `releaseVersion` = build version + commit, and
        `deleteAfterUpload: true`.
      - **Import and construct the plugin only when both vars are set**, using a dynamic import
        inside the config. The #2968 trace shows it throwing at config load ("Binary posthog-cli
        not found"), which would crash `pnpm dev`.
      - After installing, run plain `pnpm install` and check for `ERR_PNPM_IGNORED_BUILDS`.
        `@posthog/cli` may need an `allowBuilds` entry with a why-comment.
- [x] **3.3 Browser exception ownership.** `observability/otel.ts` calls `registerErrorCapture()`
      only when `!posthogEnabled`. Update its doc comment and `docs/observability.md`.
- [x] **3.4 Identity / reset.** `authStore.clear()` stops resetting. `useLogout` calls reset. In
      `setSession`:
      - if PostHog is identified (`get_property('$user_state') === 'identified'`) as an id other
        than `user.id`, call `reset()` first;
      - then `identify` if `get_distinct_id() !== user.id`.

      Check the posthog-js API against docs first. Add tests for login, refresh-same-user,
      refresh-failure-then-other-user, and logout.
- [x] **3.5 Bundle size.** Run `pnpm --filter frontend build` and compare the entry chunk size
      with and without posthog-js. If posthog-js adds > ~30 kB gzip to the entry, make
      `lib/posthog.ts` a facade that dynamically imports posthog-js after render (like OTel). The
      facade exposes `capture`, `identify`, `reset`, `captureException` and `logger`, buffers calls
      until load, and makes the `if (posthogEnabled)` guards at call sites unnecessary. Record the
      measured numbers here.
      - Measured: entry chunk 339 kB → 446 kB gzip with posthog-js eager (+107 kB). Facade
        built; the entry is back to 339 kB and posthog-js is its own chunk.

## Phase 4 — Server-side analytics (`posthog-node`)

- [x] **4.1 Install `posthog-node`** in the server package, and add an ADR mention (Phase 6).
- [x] **4.2 `observability/posthog.ts`.**
      - Pass `shutdown(timeoutMs)` a timeout shorter than the force-exit timer in `index.ts`.
      - A lazy singleton client: `null` when `!posthogEnabled`, or under `NODE_ENV=test` or a
        `:memory:` URL (the same rule as `bootstrapAdmin`).
      - Exports `getPostHog()` and `shutdownPostHog()`.
      - `shutdownPostHog` is chained in `index.ts` after `shutdownTelemetry`.
- [x] **4.3 New `game.created` domain event** (`events/types.ts`): `gameId`, `createdByUserId`,
      `visibility`, `allowShortSelling`, `allowGTC` and `createdAt`. Emitted in `POST /games`
      next to the existing `player.joined` emit.
- [x] **4.4 `analytics/posthog-subscriber.ts`** (or under `observability/`): `registerAnalytics(bus, db, client)`.
      - It maps events to PostHog events as in the table below.
      - `gamePlayerId → userId` is resolved with a bounded cache, mirroring `resolvePlayer` in
        `workers/pending-orders.ts`. The mapping never changes.
      - Every capture carries `game_id` and `environment` as properties.
      - Add `origin: 'player' | 'settler' | 'admin'` to `TradeExecutedEvent` at its three emit
        sites (`trade-emit.ts`, `workers/pending-orders.ts`, `routes/admin/trades.ts`). Skip
        `admin`, because an admin correction is not player activity.
      - `player.joined` carries `join_source` (invite code vs public vs creator) so the funnel keeps
        what the client used to send. Add a field to the event if the route knows it.
      - It is a no-op when the client is null.
      - It is registered in `app.ts` after the achievement engine.
- [x] **4.5 Server error tracking.** In `observability/error-capture.ts`, for status ≥ 500, also
      call `client.captureException(err, request.user?.sub ?? undefined, { route, method })`.
      Check how the user id is exposed on `request` first.
- [x] **4.6 Remove client duplicates.** Delete `game_created` (`CreateGameDialog`) and both
      `game_joined` captures (`JoinGameCard` and `JoinByCodePage`), together with their now-unused
      imports. **Keep** `trade_order_submitted`.
- [x] **4.7 Tests.**
      - The subscriber, with a fake client: it captures the expected event, distinctId and
        properties for each domain event, and does nothing when the client is null.
      - `game.created` is emitted by `POST /games`.
      - The 5xx hook calls `captureException`.

| Domain event | PostHog event | distinctId | Key properties |
|---|---|---|---|
| `game.created` | `game_created` | creator userId | visibility, short_selling_enabled, advanced_orders_enabled |
| `player.joined` | `game_joined` | userId | game_id, join_source |
| `trade.executed` (origin ≠ admin) | `trade_executed` | userId of gamePlayer | direction, quantity, price, notional, symbol, origin |
| `achievement.unlocked` | `achievement_unlocked` | userId of gamePlayer | achievement_key |
| `game.ended` | `game_finished` (one per ranked player) | userId of each player | final_rank, total_players, final_value |

`trade.executed` also fires for pending-order fills and admin trades. The client never sees
those, which is why capture is server-side.

## Phase 5 — App-side reverse proxy (`/relay`)

- [x] **5.1 Dev proxy.** In `vite.config.ts`, route `/relay/static` and `/relay/array` →
      `https://us-assets.i.posthog.com`, and `/relay` → `https://us.i.posthog.com`, stripping
      `/relay` and with `changeOrigin`. The more specific rules come first.
- [x] **5.2 Init.** In `lib/posthog.ts`, pass `api_host: VITE_POSTHOG_HOST` (now `/relay`) and
      `ui_host: VITE_POSTHOG_UI_HOST ?? 'https://us.posthog.com'`. The `.env.example` default
      comment says `/relay`.
- [x] **5.3 Container `nginx.conf`.** Revert the wizard's CSP widening back to `'self'`. Keep
      `worker-src 'self' blob:`, which replay needs. Add the three `/relay` locations with
      `proxy_ssl_server_name on`, an upstream `Host` header, and `X-Forwarded-For`/`X-Real-IP`
      (otherwise GeoIP is the server's location).
      - **Don't** copy `/otel`'s caps: replay batches are large and frequent.
      - Size `client_max_body_size` and the rate zone for replay, or it fails with silent 413s or
        429s.
- [x] **5.3b Browser OTel tracing.** Add `/relay` to the fetch instrumentation's
      `ignoreUrls` in `observability/otel.ts`. Otherwise every replay post gets a span and a
      `traceparent`.
- [x] **5.4 Verify.** Run `pnpm dev`, load the app, and confirm that `/relay/...` requests return
      200 and that events appear in PostHog (`ingested_event` becomes true).

## Phase 6 — Housekeeping

- [x] **6.1 ADR-016** in `docs/technical-decisions.md`: PostHog for product analytics, browser
      error tracking, replay and log export, alongside OTel. Record what owns which signal, why
      capture is server-side, the `/relay` ingress and its abuse caps, and why there are no groups.
- [x] **6.2 `docs/observability.md`.** Add a PostHog section: env vars, what goes where, the
      `/relay` ingress, and source maps.
- [x] **6.3 CLAUDE.md.** Add PostHog to the tech table, the env-var section, and the Observability
      notes (subscriber pattern, `/relay`, no throw when unset).
- [x] **6.4 `docs/design.md`.** Add the analytics subscriber and the `game.created` event.
- [x] **6.5 Wizard skill folder.** Add `.claude/skills/integration-javascript_web/` to
      `.gitignore` rather than deleting it; it's the user's call.
- [x] **6.6 Changeset.** Run `pnpm changeset` (minor): PostHog analytics, error tracking and logs.
- [x] **6.7 Final verification.**
      - Run `pnpm test`, `pnpm typecheck` and `pnpm lint`, plain with no bypass flags.
      - Run the frontend suite again with no PostHog env.
      - Build the frontend and server.

## Phase 7 — Deployment repo (`../MarketTrader-deployment`) — after Phases 1–6

**Done and live on 2026-10-09.** App `5917ebf` (merged `posthog` into main) and deployment
`ca0129d`/`22057c5` are pushed and shipped. The nginx site was patched, with a backup at
`/etc/nginx/sites-available/markettrader.bak.2026-10-09-021942`, and passed `nginx -t`. The env
file gained `POSTHOG_KEY`/`POSTHOG_HOST`, with a `.bak` alongside. Checks:
- `https://markettrader.app/relay/static/array.js` returns 200.
- A production `$pageview` arrived with `environment=production`.
- Session replay and exception autocapture are enabled in the project.

Still open:
- No server warning logs, so none exported yet; server events will arrive with real games.
- `tristan` has temporary passwordless sudo; see deployment `docs/deployment-selfhost.md` →
  "Agent access" to revoke it.

Repo-side edits (originally uncommitted). 7.2 reads `POSTHOG_KEY` from `/etc/markettrader/env`,
and the source-map secrets from a separate `/etc/markettrader/build.env`. 7.3 is documented in
`docs/deployment-selfhost.md` → "PostHog". What remains is the host work in 7.5 and the PostHog
settings in 7.6, both for the user.

The live nginx site is `deploy/nginx/markettrader.conf`. `provision.sh` never overwrites it,
so the host copy must be edited by hand, then checked with `nginx -t` and `deploy/nginx-check.sh`.

- [x] **7.1 nginx site.** Add the `/relay` locations (static, array, catch-all), mirroring 5.3,
      with a rate-limit zone at http scope like the `/otel` one. The CSP is unchanged apart from
      `worker-src 'self' blob:`.
- [x] **7.2 `deploy/deploy.sh`.** Export `VITE_POSTHOG_HOST=/relay` next to
      `VITE_POSTHOG_KEY`. The key comes from the host env file, so check how deploy.sh sources
      it. The source-map vars (`POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID`) are optional and
      only take effect if set on the host.
- [x] **7.3 Server env on host.** Add `POSTHOG_KEY` and `POSTHOG_HOST=https://us.i.posthog.com`
      to the env file the systemd unit reads. Document this in the deployment README or docs.
- [x] **7.4 Collector unchanged.** Server logs go to PostHog straight from the app (Phase 2), not
      via otelcol. Note this in the deployment docs.
- [x] **7.5 Manual host steps checklist** in the summary: edit the nginx site, `nginx -t`, reload,
      set env vars, `pnpm ship`, then smoke-check that `/relay/flags/?v=2` answers.
- [x] **7.6 PostHog project settings.** Enable exception autocapture and session replay, set the
      authorized domain `https://markettrader.app`, and check that the first events arrive.
