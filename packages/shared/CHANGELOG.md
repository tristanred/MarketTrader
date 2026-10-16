# @markettrader/shared

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

## 1.1.1

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

## 1.0.0

### Major Changes

- First version release.
