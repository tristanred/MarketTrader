# @markettrader/server

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
