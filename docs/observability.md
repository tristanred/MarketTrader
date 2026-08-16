# Observability

MarketTrader emits OpenTelemetry **traces, metrics, and logs** over OTLP/HTTP, from both the
server and the browser. The design rationale is ADR-015 in `docs/technical-decisions.md`.

Everything here is **off by default**. The server emits nothing unless
`OTEL_EXPORTER_OTLP_ENDPOINT` is set; the SPA emits nothing unless `VITE_OTEL_EXPORTER_URL` was
set at build time.

---

## Running the local stack

```bash
pnpm observability:up
```

That starts `grafana/otel-lgtm` — a single container bundling an OpenTelemetry Collector with
Prometheus, Tempo, and Loki behind it, plus Grafana. Then:

```bash
pnpm dev
```

with these in the workspace-root `.env`:

```
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
VITE_OTEL_EXPORTER_URL=/otel
```

Grafana is at **<http://localhost:3001>** (not 3000 — the API server owns that port). Anonymous
admin, no login. `pnpm observability:down` tears it down; the data does not survive.

> On Windows, set these in `.env` rather than inline on a Git Bash command line. MSYS rewrites
> arguments that look like absolute paths, so `VITE_OTEL_EXPORTER_URL=/otel pnpm dev` bakes
> `C:/Program Files/Git/otel` into the bundle.

### What to look at

Four dashboards are provisioned automatically, in Grafana's **MarketTrader** folder:

| Dashboard | Answers |
|---|---|
| Service Health | Is the API up and fast? Are the three workers ticking? Is the provider throttling us? |
| Trading Activity | Fills by side and mode, rejections by reason, order settlement, achievement unlocks |
| Frontend / RUM | Core Web Vitals, browser spans, uncaught JavaScript errors |
| Logs & Traces | Error logs with a one-click pivot to the trace; slowest traces; per-symbol trade rate |

They live in `deploy/grafana/` and are bind-mounted into the container — see the README there
for how the provisioning is wired and how to edit a panel. Nothing about them reaches production.

For ad-hoc digging outside the dashboards:

- **Tempo** — a browser click produces one trace spanning the SPA's `fetch` span, the server's
  `GET /games/:id` span, the `handler` span, `trade.execute`, and the undici span for the
  upstream quote fetch.
- **Prometheus** — `markettrader_*` for domain metrics, `http_client_request_duration_seconds`
  for upstream calls, `markettrader_web_vitals_*` from the browser.
- **Loki** — `{service_name="markettrader-server"}`. Every request log carries `trace_id`;
  clicking it jumps to the trace. `{service_name="markettrader-frontend"}` holds uncaught browser
  errors.

---

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | *(empty)* | Base OTLP/HTTP endpoint. **Empty disables all server telemetry.** No signal path — `/v1/traces` etc. are appended. |
| `OTEL_SERVICE_NAME` | `markettrader-server` | `service.name` on every signal. |
| `OTEL_METRIC_EXPORT_INTERVAL_MS` | `60000` | Metric push interval. |
| `OTEL_LOG_LEVEL_MIN` | `info` | Minimum pino level shipped over OTLP. Lower levels still reach journald. |
| `VITE_OTEL_EXPORTER_URL` | *(empty)* | Build-time. Base path the SPA posts to, normally `/otel`. |

Other standard `OTEL_*` variables (`OTEL_TRACES_SAMPLER`, `OTEL_EXPORTER_OTLP_HEADERS`, …) are
read by the SDK directly and are deliberately not redefined in `env.ts`.

Every signal carries the ADR-014 build stamp as resource attributes — `service.version` and
`git.commit` — so a metric spike can be tied to a specific deploy.

---

## Metric catalogue

| Metric | Type | Attributes |
|---|---|---|
| `markettrader.trades.executed` | Counter | `side`, `mode` (`immediate`/`resting`) |
| `markettrader.trade.duration` | Histogram (ms) | `side` |
| `markettrader.trades.rejected` | Counter | `reason` (e.g. `INSUFFICIENT_FUNDS`, `MARKET_CLOSED`) |
| `markettrader.provider.requests` | Counter | `provider`, `operation`, `outcome` (`ok`/`error`/`rate_limited`) |
| `markettrader.provider.duration` | Histogram (ms) | `provider`, `operation` |
| `markettrader.quote_cache.lookups` | Counter | `result` (`hit`/`miss`/`stale`) |
| `markettrader.ws.clients` | UpDownCounter | `scope` (`game`/`global`) |
| `markettrader.worker.ticks` | Counter | `worker`, `outcome` |
| `markettrader.worker.duration` | Histogram (ms) | `worker` |
| `markettrader.pending_orders.settled` | Counter | `outcome` (`filled`/`cancelled`/`triggered`/`expired`) |
| `markettrader.achievements.unlocked` | Counter | `achievement`, `rarity` |
| `markettrader.events.emitted` | Counter | `type` |
| `markettrader.web_vitals.{lcp,cls,inp,fcp,ttfb}` | Histogram | `rating` |

### Querying these in Prometheus

Dots become underscores, counters gain `_total`, histograms split into `_bucket`/`_sum`/`_count`
— **and the unit is appended to the name**. That last part is easy to miss and is the usual
reason a hand-written query returns nothing:

| Instrument shape | Series |
|---|---|
| Counter, no unit | `markettrader_trades_executed_total` |
| Histogram, unit `ms` | `markettrader_trade_duration_milliseconds_{bucket,sum,count}` |
| UpDownCounter | `markettrader_ws_clients` — a plain gauge, no `_total`, never `rate()` it |
| Histogram, unit `1` (CLS only) | `markettrader_web_vitals_cls_{bucket,sum,count}` — no suffix |

Resource attributes are promoted to real labels, so `service_name`, `service_version` and
`deployment_environment_name` can be matched directly with no `target_info` join. `git_commit` is
the exception — it lives on `target_info` only.

**There is no HTTP server metric.** `@fastify/otel` emits spans and never touches the metrics
API. Request rate, error rate and latency for inbound HTTP therefore come from Tempo's
`span-metrics` generator: `traces_spanmetrics_calls_total` and `traces_spanmetrics_latency_bucket`,
labelled `service` / `span_name` / `span_kind` / `status_code`. Two traps follow from that:

- Those series use **`service`**, while every application metric uses **`service_name`**.
- Span metrics and undici are in **seconds**; every application histogram is in **milliseconds**.

**Symbols are deliberately not metric attributes.** The symbol universe is unbounded and would
blow up cardinality. Symbols appear on spans, which are not aggregated.

`quote_cache.lookups{result="stale"}` is the one to watch: `stale` means the upstream was
rate-limited and a cached price was served instead. It is the app degrading rather than failing,
and folding it into `hit` would hide an outage.

---

## What is instrumented, and how

No module patching anywhere — see ADR-015 for why that is a hard constraint rather than a
preference.

- **HTTP server spans** — `@fastify/otel`, registered in `plugins/otel.ts`. It **must** be
  registered before every route; it wraps route definitions as they are declared and cannot
  retroactively instrument earlier ones. Registering it too low yields *partial* coverage, which
  is worse than none because it looks like it works.
- **Outbound HTTP** — `@opentelemetry/instrumentation-undici`, via `diagnostics_channel`.
- **Logs** — a pino `mixin` injects `trace_id`/`span_id`, and `pino-opentelemetry-transport`
  ships records. Both are additive: stdout/journald output is unchanged, so a collector outage
  does not take the logs with it.
- **Manual spans** — `trade.execute` (`services/trade.ts`), `provider.*`
  (`providers/cached-provider.ts`), `worker.tick` (`workers/interval-worker.ts`). Every
  background loop routes through `startIntervalWorker`, so instrumenting it once covers the price
  poller, the pending-orders settler, and the portfolio-snapshot worker.
- **Not instrumented: the database.** There is no OTel instrumentation for `postgres`
  (postgres.js) or `@libsql/client`, and `instrumentation-pg` targets `pg`, which this project
  does not use. The manual spans above cover the hot paths instead.

### Deliberate exclusions

- `/health` and `/version` are untraced (`plugins/otel.ts`). `deploy.sh` polls `/health` once a
  second during every deploy, and uptime monitors poll it forever.
- The two WebSocket routes set `config: { otel: false }`. A WS upgrade is a connection that
  stays open for hours; a request span covering it would never close and would describe nothing.

---

## Browser telemetry

`packages/frontend/src/observability/otel.ts` collects document-load and fetch traces, Core Web
Vitals as metrics, and uncaught errors plus unhandled rejections as log records. Browser error
reporting is new capability — Sentry was server-side only, so these were never reported anywhere.

It is loaded with a dynamic `import()` *after* first render, so it lands in its own chunk
(~160 kB raw, ~46 kB gzipped) rather than the entry bundle, and a failure to load can never stop
the app from starting.

Trace context propagates to the API because requests are same-origin (`API_BASE = '/api'`), so
`traceparent` rides along without a CORS preflight and the server's span joins the browser's
trace.

LCP, CLS, and INP finalize on page-hide or interaction rather than at load, so a page you only
glance at reports TTFB and FCP.

---

## The `/otel` ingress

The browser posts to a relative `/otel` path, proxied to the collector's OTLP/HTTP port:

- **dev** — the `/otel` rule in `packages/frontend/vite.config.ts` → `localhost:4318`.
- **production** — the `location /otel/` block in `deploy/nginx/markettrader.conf`.

### Two things to know before deploying it

**1. It is an unauthenticated public write path.** It has to be: the SPA collects Web Vitals on
the login page, before anyone signs in. The nginx block therefore caps body size
(`client_max_body_size 256k`) and rate (`limit_req`). Without those, anyone who finds the path
can flood Prometheus and Loki.

**2. The nginx change does not deploy itself.** `provision.sh` refuses to overwrite an existing
site file, and `certbot --nginx` has rewritten the installed copy in place — so `pnpm ship`
ignores it. The failure is silent: browser telemetry 404s and the SPA keeps working, so nothing
surfaces the gap. Run `deploy/nginx-check.sh` to see the missing block, and follow "Changing the
nginx site" in `docs/deployment-selfhost.md`.

---

## Not done yet

There is **no production collector**. `OTEL_EXPORTER_OTLP_ENDPOINT` is unset in production, so
the server emits nothing and errors reach journald only — nothing alerts. Standing up a collector
and a Grafana/Prometheus backend, then choosing dashboards and alert rules, is the follow-up to
this work. Until then, `journalctl -u markettrader` remains the way to investigate an incident.
