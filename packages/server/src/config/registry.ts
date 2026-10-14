import { z } from 'zod';
import type { ConfigCategory, ConfigKind } from '@markettrader/shared';
import type { env, liveBootConfig } from '../env.js';
import {
  VALID_MARKET_HOURS_MODES,
  VALID_MARKET_STATUS_PROVIDERS,
  VALID_NODE_ENVS,
  VALID_PROVIDERS,
  wasSetInEnvironment,
} from '../env.js';

/** Options read once at startup. */
export type RestartKey = keyof typeof env;
/** Options an admin may override at runtime. */
export type LiveKey = keyof typeof liveBootConfig;
/** Every option the server reads from its environment. */
export type EnvKey = RestartKey | LiveKey;

/** Typed, mutable view of the live options' values. */
export type LiveConfigValues = { -readonly [K in LiveKey]: (typeof liveBootConfig)[K] };

interface DescriptorBase {
  category: ConfigCategory;
  kind: ConfigKind;
  description: string;
  /** Variable names read, in precedence order, when they differ from the key. */
  envVars?: readonly string[];
  unit?: 'ms';
  options?: readonly string[];
  /** Never sent to the client; the panel only learns whether it is set. */
  secret?: boolean;
  /** A URL whose credentials are masked before display. */
  redactUrl?: boolean;
}

/** An option the admin panel may override. `min`/`max` bound overrides, not the environment. */
export interface LiveDescriptor extends DescriptorBase {
  mutability: 'live';
  min?: number;
  max?: number;
}

/** An option consumed once at startup and therefore shown read-only. */
export interface RestartDescriptor extends DescriptorBase {
  mutability: 'restart';
  restartReason: string;
}

export type ConfigDescriptor = LiveDescriptor | RestartDescriptor;

const PROVIDER_BOOT = 'The provider client is constructed once at startup.';
const OTEL_BOOT = 'The OpenTelemetry SDK and log transport start before the app is built.';
const POSTHOG_BOOT = 'The PostHog client and log transport start before the app is built.';

/**
 * Describes every option for the admin configuration panel. The `satisfies`
 * clause requires exactly one descriptor per key of `env` (restart) and of
 * `liveBootConfig` (live), so moving a key between them forces its descriptor
 * to change kind too.
 */
export const CONFIG_REGISTRY = {
  // ── core ────────────────────────────────────────────────────────────────
  PORT: {
    category: 'core', kind: 'integer', mutability: 'restart',
    description: 'TCP port the HTTP server listens on.',
    restartReason: 'Bound once by listen() at startup.',
  },
  NODE_ENV: {
    category: 'core', kind: 'enum', options: VALID_NODE_ENVS, mutability: 'restart',
    description: 'Runtime mode. production enables boot-time hardening checks and secure cookies.',
    restartReason: 'Selects logging, hardening, and cookie flags at startup.',
  },
  CORS_ORIGIN: {
    category: 'core', kind: 'string', mutability: 'restart',
    description: 'Frontend origin allowed to call the API cross-origin.',
    restartReason: 'Passed to @fastify/cors when the server is built.',
  },

  // ── security ────────────────────────────────────────────────────────────
  JWT_SECRET: {
    category: 'security', kind: 'string', secret: true, mutability: 'restart',
    description: 'Signs access and refresh tokens. At least 32 characters in production.',
    restartReason: 'Changing it invalidates every issued token; set it in the environment.',
  },
  TRUST_PROXY: {
    category: 'security', kind: 'string', mutability: 'restart',
    description:
      'Which upstream hops may set X-Forwarded-For: false, a hop count, a preset (loopback, linklocal, uniquelocal), or an address/CIDR list. Decides request.ip, the key of every rate limit.',
    restartReason: 'Fastify reads it once when the server is constructed.',
  },
  LOGIN_MAX_FAILED_ATTEMPTS: {
    category: 'security', kind: 'integer', mutability: 'restart',
    description: 'Consecutive failed logins for one username before it is throttled.',
    restartReason: 'Captured when the login tracker is constructed.',
  },
  LOGIN_FAILURE_WINDOW_MS: {
    category: 'security', kind: 'integer', unit: 'ms', mutability: 'restart',
    description: 'Failures older than this stop counting toward the threshold.',
    restartReason: 'Captured when the login tracker is constructed.',
  },
  LOGIN_LOCKOUT_MS: {
    category: 'security', kind: 'integer', unit: 'ms', mutability: 'restart',
    description: 'How long a throttled username stays locked. Keep short: anyone can trigger it for any name.',
    restartReason: 'Captured when the login tracker is constructed.',
  },

  // ── database ────────────────────────────────────────────────────────────
  DATABASE_URL: {
    category: 'database', kind: 'string', redactUrl: true, mutability: 'restart',
    description: 'postgres:// URL, libsql URL, or SQLite file path.',
    restartReason: 'The database connection is opened before anything else.',
  },
  SQLITE_BUSY_TIMEOUT_MS: {
    category: 'database', kind: 'integer', unit: 'ms', mutability: 'restart',
    description: 'How long a SQLite writer waits on a contended lock. Ignored under Postgres.',
    restartReason: 'Applied as a per-connection PRAGMA at startup.',
  },

  // ── stock data ──────────────────────────────────────────────────────────
  STOCK_PROVIDER: {
    category: 'stock-data', kind: 'enum', options: VALID_PROVIDERS, mutability: 'restart',
    description: 'Upstream price provider.',
    restartReason: PROVIDER_BOOT,
  },
  ALPACA_API_KEY_ID: {
    category: 'stock-data', kind: 'string', secret: true, mutability: 'restart',
    envVars: ['ALPACA_API_KEY_ID', 'ALPACA_API_KEY'],
    description: 'Alpaca API key ID. Required with the secret when either provider is alpaca.',
    restartReason: PROVIDER_BOOT,
  },
  ALPACA_API_SECRET_KEY: {
    category: 'stock-data', kind: 'string', secret: true, mutability: 'restart',
    description: 'Alpaca API secret key.',
    restartReason: PROVIDER_BOOT,
  },
  STOCK_CACHE_TTL_MS: {
    category: 'stock-data', kind: 'integer', unit: 'ms', mutability: 'restart',
    description: 'How long a cached quote is served before re-fetching upstream.',
    restartReason: 'Not yet routed through runtime config.',
  },
  STOCK_SEARCH_CACHE_TTL_MS: {
    category: 'stock-data', kind: 'integer', unit: 'ms', mutability: 'restart',
    description: 'How long symbol-search results are cached.',
    restartReason: 'Not yet routed through runtime config.',
  },
  STOCK_HISTORY_CACHE_TTL_MS: {
    category: 'stock-data', kind: 'integer', unit: 'ms', mutability: 'restart',
    description: 'How long price-history results are cached.',
    restartReason: 'Not yet routed through runtime config.',
  },
  STOCK_STALE_PRICE_MAX_AGE_MS: {
    category: 'stock-data', kind: 'integer', unit: 'ms', mutability: 'restart',
    description: 'While rate-limited, cached quotes up to this old are served instead of an error.',
    restartReason: 'Not yet routed through runtime config.',
  },
  STOCK_RATE_LIMIT_BACKOFF_MS: {
    category: 'stock-data', kind: 'integer', unit: 'ms', mutability: 'restart',
    description: 'After an upstream 429, refuse upstream calls for this long.',
    restartReason: 'Not yet routed through runtime config.',
  },
  STOCK_ALLOW_STALE_TRADES: {
    category: 'stock-data', kind: 'boolean', mutability: 'restart',
    description: 'When rate-limited, fill trades at the cached price instead of rejecting. Favors availability over fairness.',
    restartReason: 'Not yet routed through runtime config.',
  },
  STOCK_STALE_TRADE_MAX_AGE_MS: {
    category: 'stock-data', kind: 'integer', unit: 'ms', mutability: 'restart',
    description: 'Stale trades using a cached price older than this are rejected anyway.',
    restartReason: 'Not yet routed through runtime config.',
  },

  // ── market hours ────────────────────────────────────────────────────────
  MARKET_STATUS_PROVIDER: {
    category: 'market-hours', kind: 'enum', options: VALID_MARKET_STATUS_PROVIDERS, mutability: 'restart',
    description: 'Source of open/closed market state. Defaults to match STOCK_PROVIDER.',
    restartReason: PROVIDER_BOOT,
  },
  MARKET_STATUS_CACHE_TTL_MS: {
    category: 'market-hours', kind: 'integer', unit: 'ms', mutability: 'restart',
    description: 'How long the market open/closed state is cached.',
    restartReason: 'Captured when the market-status cache is constructed.',
  },
  MARKET_HOURS_MODE: {
    category: 'market-hours', kind: 'enum', options: VALID_MARKET_HOURS_MODES, mutability: 'restart',
    description: 'Closed-market trades: instant fills at last price, disabled rejects, pending queues for next open.',
    restartReason: 'The pending-orders worker is only started when the server boots in pending mode.',
  },
  MARKET_HOURS_INCLUDE_EXTENDED: {
    category: 'market-hours', kind: 'boolean', mutability: 'restart',
    description: 'Count pre- and post-market sessions as open for trading.',
    restartReason: 'Not yet routed through runtime config.',
  },

  // ── workers ─────────────────────────────────────────────────────────────
  PENDING_ORDERS_TICK_MS: {
    category: 'workers', kind: 'integer', unit: 'ms', mutability: 'restart',
    description: 'How often pending orders settle and resting orders are checked for fills and expiry.',
    restartReason: 'The worker arms its timer once at startup.',
  },
  PORTFOLIO_SNAPSHOT_INTERVAL_MS: {
    category: 'workers', kind: 'integer', unit: 'ms', mutability: 'restart',
    description: 'How often every active player’s portfolio value is captured for charts.',
    restartReason: 'The worker arms its timer once at startup.',
  },
  DISCOVER_REFRESH_INTERVAL_MS: {
    category: 'workers', kind: 'integer', unit: 'ms', mutability: 'restart',
    description: 'How often the Discover worker looks for missing market-mover and daily-pick lists.',
    restartReason: 'The worker arms its timer once at startup.',
  },

  // ── limits ──────────────────────────────────────────────────────────────
  PRICE_POLLER_MAX_SYMBOLS: {
    category: 'limits', kind: 'integer', mutability: 'restart',
    description: 'Most symbols one price-poller tick may fetch. Watchlist symbols are dropped first.',
    restartReason: 'Not yet routed through runtime config.',
  },
  WATCHLIST_MAX_ITEMS: {
    category: 'limits', kind: 'integer', mutability: 'live', min: 1, max: 500,
    description: 'Symbols one watchlist may hold. Lowering it does not trim existing lists.',
  },
  WATCHLIST_MAX_PER_USER: {
    category: 'limits', kind: 'integer', mutability: 'live', min: 1, max: 200,
    description: 'Watchlists one user may own. Lowering it does not delete existing lists.',
  },

  // ── websocket ───────────────────────────────────────────────────────────
  WS_HEARTBEAT_INTERVAL_MS: {
    category: 'websocket', kind: 'integer', unit: 'ms', mutability: 'restart',
    description: 'Ping cadence for live sockets. Keep below the proxy idle timeout.',
    restartReason: 'Armed once, and the missed-ping check assumes a fixed period.',
  },
  WS_REVALIDATE_INTERVAL_MS: {
    category: 'websocket', kind: 'integer', unit: 'ms', mutability: 'restart',
    description: 'How often live sockets are re-checked for expired tokens and revoked access.',
    restartReason: 'Each WebSocket route arms its sweep timer once at registration.',
  },

  // ── observability ───────────────────────────────────────────────────────
  OTEL_EXPORTER_OTLP_ENDPOINT: {
    category: 'observability', kind: 'string', redactUrl: true, mutability: 'restart',
    description: 'OTLP/HTTP collector base URL. Empty disables all telemetry.',
    restartReason: OTEL_BOOT,
  },
  OTEL_SERVICE_NAME: {
    category: 'observability', kind: 'string', mutability: 'restart',
    description: 'service.name on every span, metric, and log record.',
    restartReason: OTEL_BOOT,
  },
  OTEL_METRIC_EXPORT_INTERVAL_MS: {
    category: 'observability', kind: 'integer', unit: 'ms', mutability: 'restart',
    description: 'How often metrics are pushed to the collector.',
    restartReason: OTEL_BOOT,
  },
  OTEL_LOG_LEVEL_MIN: {
    category: 'observability', kind: 'string', mutability: 'restart',
    description: 'Minimum pino level shipped over OTLP. stdout still gets everything.',
    restartReason: OTEL_BOOT,
  },

  // ── analytics ───────────────────────────────────────────────────────────
  POSTHOG_KEY: {
    category: 'analytics', kind: 'string', secret: true, mutability: 'restart',
    description: 'PostHog project token. With POSTHOG_HOST, enables server analytics, errors, and logs.',
    restartReason: POSTHOG_BOOT,
  },
  POSTHOG_HOST: {
    category: 'analytics', kind: 'string', redactUrl: true, mutability: 'restart',
    description: 'PostHog ingestion host.',
    restartReason: POSTHOG_BOOT,
  },
  POSTHOG_LOG_LEVEL_MIN: {
    category: 'analytics', kind: 'string', mutability: 'restart',
    description: 'Minimum pino level exported to PostHog Logs (billed by volume).',
    restartReason: POSTHOG_BOOT,
  },
} as const satisfies { [K in RestartKey]: RestartDescriptor } & { [K in LiveKey]: LiveDescriptor };

/** True for an own key of the registry; prototype names like `toString` are rejected. */
export function isConfigKey(key: string): key is EnvKey {
  return Object.hasOwn(CONFIG_REGISTRY, key);
}

/** The descriptor for `key`, widened so optional fields can be read without narrowing. */
export function descriptorFor(key: EnvKey): ConfigDescriptor {
  return CONFIG_REGISTRY[key];
}

/** True when `key` names an option the admin panel may override at runtime. */
export function isLiveKey(key: string): key is LiveKey {
  return isConfigKey(key) && descriptorFor(key).mutability === 'live';
}

/** Every live key, in registry order. */
export function liveKeys(): LiveKey[] {
  return Object.keys(CONFIG_REGISTRY).filter((k): k is LiveKey => isLiveKey(k));
}

/** True when any of the key's variables was present in the process environment at boot. */
export function isExplicitlySet(key: EnvKey): boolean {
  return (descriptorFor(key).envVars ?? [key]).some(wasSetInEnvironment);
}

/**
 * Zod schema an override of `key` must satisfy. Stricter than env parsing:
 * integers carry the descriptor's bounds, and JSON types must match exactly.
 */
export function liveValueSchema<K extends LiveKey>(key: K): z.ZodType<LiveConfigValues[K]> {
  const d = descriptorFor(key);
  if (d.mutability !== 'live') throw new Error(`${key} is not live`);
  // The schema is built from the descriptor's kind, and registry.test.ts checks
  // that each live kind matches the type env.ts parses — which is what makes
  // this the right value type for K.
  return schemaForKind(key, d) as z.ZodType<LiveConfigValues[K]>;
}

function schemaForKind(key: string, d: LiveDescriptor): z.ZodType<string | number | boolean> {
  switch (d.kind) {
    case 'integer':
      return z.number().int().min(d.min ?? 1).max(d.max ?? Number.MAX_SAFE_INTEGER);
    case 'boolean':
      return z.boolean();
    case 'enum': {
      const [first, ...rest] = d.options ?? [];
      if (first === undefined) throw new Error(`${key} has no options`);
      const values: [string, ...string[]] = [first, ...rest];
      return z.enum(values);
    }
    case 'string':
      return z.string().max(2048);
  }
}
