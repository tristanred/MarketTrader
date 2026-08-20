# @markettrader/shared

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
