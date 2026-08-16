import type { FastifyInstance } from 'fastify';
import FastifyOtelInstrumentation from '@fastify/otel';
import { telemetryEnabled } from '../env.js';

// Probes. Traced they would be pure noise: /health is polled every second by
// deploy.sh's wait_for_health and by any uptime monitor, and /version is hit
// on every deploy.
const UNTRACED_ROUTES = new Set(['/health', '/version']);

/**
 * Registers `@fastify/otel`, which produces the request span, route-templated
 * span names, and inbound trace-context extraction.
 *
 * Registered as an ordinary plugin rather than through the SDK's
 * `instrumentations` array — that path monkey-patches the `fastify` module,
 * which cannot work once tsup bundles the server (ADR-015). No-op when
 * telemetry is disabled, so the plugin does not add hooks to every request.
 *
 * Must be registered before any route: `@fastify/otel` wraps route definitions
 * as they are declared and cannot retroactively instrument earlier ones.
 */
export async function registerOtel(app: FastifyInstance): Promise<void> {
  if (!telemetryEnabled) return;

  const instrumentation = new FastifyOtelInstrumentation({
    recordExceptions: true,
    ignorePaths: (routeOpts) => UNTRACED_ROUTES.has(routeOpts.url),
    // Every route in this app is declared inside a factory plugin
    // (`stockRoutes(db, provider)` and friends), so the functions @fastify/otel
    // names its hook spans after are anonymous. It falls back to the function
    // *source*, producing multi-kilobyte span names like
    // `handler - async function(rawApp){const app=rawApp.withTypeProvider()...`.
    // The hook spans cover third-party plugin internals (cors, helmet, cookie)
    // that nobody debugs from a trace, so drop them rather than pay to store
    // six unreadable spans per request.
    instrumentHooks: false,
    requestHook: (span, request) => {
      // @fastify/otel names the request span `request`, which makes every trace
      // in Grafana's list look identical. The HTTP semconv calls for
      // `{method} {route}` — it already sets those as attributes, so the name
      // is the only thing missing.
      const route = request.routeOptions?.url;
      if (route) span.updateName(`${request.method} ${route}`);
    },
    lifecycleHook: (span, info) => {
      // `instrumentHooks: false` still leaves the handler span, and it hits the
      // same anonymous-function problem described above — 2.6 KB of source as a
      // span name. Rename it to the route it actually serves.
      const route = info.request.routeOptions?.url;
      if (route) span.updateName(`${info.hookName} ${route}`);
    },
  });

  await app.register(instrumentation.plugin());
}
