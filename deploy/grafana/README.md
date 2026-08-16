# Grafana dashboards

Four dashboards for the local telemetry stack, provisioned automatically:

| File | Board | What it answers |
|---|---|---|
| `dashboards/service-health.json` | Service Health | Is the API up, fast, and are the workers ticking? |
| `dashboards/trading-activity.json` | Trading Activity | What are players doing — fills, rejections, unlocks? |
| `dashboards/frontend-rum.json` | Frontend / RUM | How does the SPA feel to a real user? |
| `dashboards/logs-and-traces.json` | Logs & Traces | Why did that one request fail? |

```bash
pnpm observability:up          # Grafana on http://localhost:3001, folder "MarketTrader"
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 pnpm dev
```

Without `OTEL_EXPORTER_OTLP_ENDPOINT` the server emits nothing and every panel stays empty.

## How the provisioning works

`docker-compose.observability.yml` bind-mounts two things into the `grafana/otel-lgtm`
container:

- `provisioning/markettrader.yaml` → `/otel-lgtm/grafana/conf/provisioning/dashboards/`
- `dashboards/` → `/otel-lgtm/grafana/dashboards/markettrader`

The JSON deliberately lands **outside** the provisioning tree. Grafana parses every file in a
provisioning directory, so a dashboard sitting next to the provider yaml is logged as a broken
provider config on each boot.

Note the image keeps its Grafana config under `/otel-lgtm`, not the usual `/etc/grafana`, and
that path is not on the `lgtm_data` volume — which is what makes these mounts stick.

Edits to a dashboard file are picked up within ten seconds; no restart needed. Changing the
compose file does need `pnpm observability:up` again to recreate the container.

If a board is missing, check the mount before suspecting a query:

```bash
docker exec markettrader-lgtm ls /otel-lgtm/grafana/dashboards/markettrader
```

## Writing queries against this stack

Three things trip people up, all verified against a running stack:

**1. The service label differs by signal family.** Application metrics carry `service_name`;
Tempo's span metrics carry `service`. Mixing them up empties half a dashboard.

```promql
markettrader_trades_executed_total{service_name="markettrader-server"}   # OTLP metrics
traces_spanmetrics_calls_total{service="markettrader-server"}            # span metrics
```

**2. There is no HTTP server metric.** `@fastify/otel` emits spans only — it never imports the
metrics API. Every inbound-HTTP number comes from Tempo's `span-metrics` generator
(`traces_spanmetrics_calls_total` / `traces_spanmetrics_latency_bucket`), which is why request
rate is a trace-derived figure here. Outbound HTTP is different: `instrumentation-undici` does
emit `http_client_request_duration_seconds`.

**3. Units are not uniform.** Application histograms are in **milliseconds**; span metrics and
undici are in **seconds**. A p95 rendering as "250 s" means the panel unit is wrong.

Resource attributes are promoted to real labels (`service_name`, `service_version`,
`deployment_environment_name`), so no `target_info` join is needed — except for `git_commit`,
which stays on `target_info` only.

**Exemplars render but do not link.** Tempo's generator writes the exemplar label as `traceID`,
while the image's Prometheus datasource looks for `trace_id`. Hovering a diamond on the latency
panel shows the trace ID, but Grafana renders no "Query with Tempo" action. The drilldown that
does work is the Loki `trace_id` derived field on the Logs & Traces board.

Symbols are deliberately absent from every metric (unbounded cardinality). The only per-symbol
view is the TraceQL panel on the Logs & Traces board.

## Editing

Change a panel in the UI to experiment — `allowUiUpdates` is on — then copy the JSON back into
the file, because the next provisioning reload overwrites whatever is in the database. The files
on disk are canonical.

These dashboards target the local stack only. Production has no collector yet, so nothing here
reaches prod; see the "Not done yet" section of `docs/observability.md`.
