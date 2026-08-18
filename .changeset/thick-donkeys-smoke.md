---
'@markettrader/server': minor
'@markettrader/frontend': minor
'@markettrader/shared': minor
---

Add OpenTelemetry traces, metrics, and logs across the server and the SPA, exported over OTLP to
an OpenTelemetry Collector. `pnpm observability:up` starts a local Grafana LGTM stack to view
them. Everything is off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set.

Instrumentation is patch-free — `@fastify/otel` as a plugin, undici via `diagnostics_channel` —
so no `node --import` bootstrap and no systemd change (ADR-015). Adds 12 domain metrics (trades,
provider cache and rate limiting, WebSocket clients, worker ticks, achievements, events) plus
browser traces, Web Vitals, and uncaught-error reporting.

Sentry is removed. Its 5xx hook read `reply.statusCode` in `onError`, where Fastify has not
applied the status yet, so it had been reporting every thrown 4xx as a server fault; the
replacement reads `err.statusCode` first. Until a collector is deployed, production errors reach
journald only and nothing alerts.
