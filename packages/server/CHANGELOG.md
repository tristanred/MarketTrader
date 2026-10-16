# @markettrader/server

## 1.2.0

### Minor Changes

- 5274b52: Admin configuration panel at `/admin/config`: every option the server reads from its environment, with its effective value (secrets masked), where it came from, and whether it can change live. Cache TTLs, rate-limit backoff, stale-trade policy, market-hours mode, login-throttle thresholds, worker intervals, and watchlist/poller caps can be overridden from the panel; overrides apply from the next read (a wait already in progress finishes first), persist across restarts, and win over the environment until reset. The pending-orders worker now runs in every market-hours mode, so limit/stop/bracket orders fill and day orders expire on servers using the default `instant` mode too.
- 1328844: Stock chart: candlesticks and volume, the viewer's trades as buy/sell markers with an avg-cost line, and a Line / Area / Candles toggle. History bars now carry OHLC + volume and the response reports `barSeconds`.
- 4a32389: Discover: each game gets a daily page of stocks to consider — 20 S&P 500 picks drawn for the game, plus the market's top gainers, losers, most active and trending tickers. Lists are built by a background worker after each market close (`DISCOVER_REFRESH_INTERVAL_MS`, default 5 min), so the page never waits on the price provider. Reached from a Discover link in the top nav and a teaser panel in the arena.
- 783c934: PostHog: product analytics, error tracking, session replay, and log export (ADR-016).
  Business events are captured server-side from the domain event bus; the browser reaches
  PostHog through a same-origin `/relay` proxy and loads the SDK after first render. Server
  5xx go to PostHog error tracking, and pino logs can be exported to PostHog Logs. All of it
  is off unless `POSTHOG_KEY`/`POSTHOG_HOST` (server) and `VITE_POSTHOG_KEY`/`VITE_POSTHOG_HOST`
  (build) are set. Deployments need a `/relay` route on the reverse proxy.
- 0aae532: Arena: the ticker in the quote strip (marked with a small ⓘ) now opens the quote information window, so players no longer have to go through Buy or Sell to see a stock's details.
- d3e3c9e: Quote information: a "View on TradingView" link opens the symbol's TradingView page in a new tab, for digging deeper into a stock.

### Patch Changes

- ca46620: Security: upgrade fastify, @fastify/jwt and yahoo-finance2, and refresh vulnerable transitive dependencies flagged by Dependabot. `TRUST_PROXY` no longer accepts a hop count: Fastify 5.12.7 treats a numeric `trustProxy` as trusting nothing, so the server now refuses one at boot. Use `loopback`, `uniquelocal`, or the proxy's address instead.
- 7a3225c: Dialogs now fit the screen: a dialog taller than the window scrolls inside itself instead of running off the top and bottom with no way to reach them. In the quote window the mouse wheel scrolls the window even over the chart (drag still pans the chart).
- Updated dependencies [5274b52]
- Updated dependencies [1328844]
- Updated dependencies [ca46620]
- Updated dependencies [7a3225c]
- Updated dependencies [4a32389]
- Updated dependencies [783c934]
- Updated dependencies [0aae532]
- Updated dependencies [d3e3c9e]
  - @markettrader/shared@1.2.0

## 1.1.1

### Patch Changes

- a49dc4e: Fix the WebSocket reconnect loop that produced ~15k reconnects/day per browser session.

  Both socket hooks now share `ReconnectController`: exponential backoff with jitter, a 30s ceiling, and a 10-attempt cap. The attempt counter clears only after a connection has stayed open for 30s, so a socket that opens and immediately drops no longer resets to a 1s delay on every cycle. `useIndicesSocket` had no backoff at all and reconnected on a flat 5s timer.

  When a socket spends its attempt budget it stops instead of looping forever; the `LIVE` pill in the status strip becomes a retry button, and the connection also re-tests itself when the browser comes back online or the tab returns to the foreground.

  Server-side, `startWsHeartbeat` pings every connected client every `WS_HEARTBEAT_INTERVAL_MS` (default 30s) and terminates clients that missed the previous ping, so idle sockets are not silently reaped by an intermediary.

- @markettrader/shared@1.1.1

## 1.1.0

### Minor Changes

- 8dd62af: Add OpenTelemetry traces, metrics, and logs across the server and the SPA, exported over OTLP to
  an OpenTelemetry Collector. Point `OTEL_EXPORTER_OTLP_ENDPOINT` at any OTLP/HTTP collector to view
  them. Everything is off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set.

  Instrumentation is patch-free — `@fastify/otel` as a plugin, undici via `diagnostics_channel` —
  so no `node --import` bootstrap and no systemd change (ADR-015). Adds 12 domain metrics (trades,
  provider cache and rate limiting, WebSocket clients, worker ticks, achievements, events) plus
  browser traces, Web Vitals, and uncaught-error reporting.

  Sentry is removed. Its 5xx hook read `reply.statusCode` in `onError`, where Fastify has not
  applied the status yet, so it had been reporting every thrown 4xx as a server fault; the
  replacement reads `err.statusCode` first. Until a collector is configured, errors reach the
  process logs only and nothing alerts.

### Patch Changes

- 7b9f1c0: Upgrade `yahoo-finance2` to v4. v3 is no longer supported upstream; v4's only
  breaking change is requiring Node 22+, which this project already exceeds. The
  provider's call surface is unchanged.
- 1a9a2d3: Stop trusting client-supplied proxy headers, which made every per-IP rate limit
  bypassable.

  The server was built with `trustProxy: true`, so `request.ip` resolved to the
  leftmost entry of the caller's own `X-Forwarded-For` — and that is the key
  `@fastify/rate-limit` buckets on. Rotating the header gave a fresh bucket per
  request, lifting every cap including the 5/min on `POST /auth/login`. The
  trusted-proxy set is now bounded by a new `TRUST_PROXY` variable (default
  `loopback`), and `true` is refused in production. Both nginx sites now overwrite
  `X-Forwarded-For` rather than prepending the client's value.

  Login additionally gained a per-account failed-attempt throttle that does not
  depend on network identity at all, tunable via `LOGIN_MAX_FAILED_ATTEMPTS`,
  `LOGIN_FAILURE_WINDOW_MS` and `LOGIN_LOCKOUT_MS`. The sign-in form reports the
  resulting 429 instead of a generic failure.

  **The reverse-proxy change is not applied by deploying.** Proxy configuration is
  maintained outside this repo and has to be updated there.

- 3473c15: Clear all open Dependabot advisories. Refreshes the lockfile and raises dependency
  floors so the fixes stick, upgrades `@fastify/swagger-ui` to v6 (the only route to a
  patched `@fastify/static`), and unpins the exact-version `vite` override that was
  holding the frontend on a vulnerable 6.4.2.
- Updated dependencies [8dd62af]
  - @markettrader/shared@1.1.0

## 1.0.0

### Major Changes

- First version release.

### Patch Changes

- Updated dependencies
  - @markettrader/shared@1.0.0
