import path from 'node:path';
import { isIP } from 'node:net';

// TODO(polygon-provider): add 'polygon' once PolygonProvider is implemented
const VALID_PROVIDERS = ['yahoo', 'alpaca', 'mock'] as const;
type StockProvider = (typeof VALID_PROVIDERS)[number];

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function parsePort(raw: string): number {
  const port = parseInt(raw, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT value: "${raw}". Must be an integer between 1 and 65535.`);
  }
  return port;
}

function parsePositiveInt(name: string, raw: string): number {
  const n = parseInt(raw, 10);
  if (isNaN(n) || n <= 0) {
    throw new Error(`Invalid ${name}: "${raw}". Must be a positive integer.`);
  }
  return n;
}

function parseBool(raw: string): boolean {
  return raw.trim().toLowerCase() === 'true';
}

/** Named address ranges `proxy-addr` understands, accepted verbatim by Fastify. */
const TRUST_PROXY_PRESETS = ['loopback', 'linklocal', 'uniquelocal'] as const;

/** True for `10.0.0.0/8`, `::1/128`, and bare addresses in either family. */
function isAddressOrSubnet(token: string): boolean {
  const slash = token.indexOf('/');
  if (slash === -1) return isIP(token) !== 0;
  const address = token.slice(0, slash);
  const prefix = token.slice(slash + 1);
  const family = isIP(address);
  if (family === 0 || !/^\d+$/.test(prefix)) return false;
  return Number(prefix) <= (family === 4 ? 32 : 128);
}

/**
 * Parses `TRUST_PROXY` into Fastify's `trustProxy` option: `false`, a hop count,
 * a {@link TRUST_PROXY_PRESETS} name, or a comma-separated list of addresses and
 * CIDR subnets.
 *
 * Anything Fastify would accept but that is not one of those forms is rejected
 * here rather than at request time. `proxy-addr` compiles its trust list lazily,
 * so a typo would otherwise boot cleanly and only misresolve `request.ip` under
 * traffic — which silently keys every rate limit on the wrong value.
 *
 * `true` parses (some operators genuinely front the app with a chain they
 * control) but {@link validateProductionEnv} refuses it in production.
 */
export function parseTrustProxy(raw: string): boolean | number | string {
  const value = raw.trim();
  if (value === '' || value.toLowerCase() === 'false') return false;
  if (value.toLowerCase() === 'true') return true;
  if (/^\d+$/.test(value)) return Number(value);

  const tokens = value.split(',').map((t) => t.trim());
  const valid = tokens.every(
    (t) =>
      (TRUST_PROXY_PRESETS as readonly string[]).includes(t) || isAddressOrSubnet(t),
  );
  if (!valid) {
    throw new Error(
      `Invalid TRUST_PROXY: "${raw}". Must be true, false, a hop count, ` +
        `one of ${TRUST_PROXY_PRESETS.join(', ')}, or a comma-separated list of ` +
        `IP addresses and CIDR subnets.`,
    );
  }
  return tokens.join(', ');
}

function validatedProvider(): StockProvider {
  const value = optional('STOCK_PROVIDER', 'yahoo');
  if (!(VALID_PROVIDERS as readonly string[]).includes(value)) {
    throw new Error(
      `Invalid STOCK_PROVIDER: "${value}". Must be one of: ${VALID_PROVIDERS.join(', ')}`,
    );
  }
  return value as StockProvider;
}

const VALID_MARKET_STATUS_PROVIDERS = ['yahoo', 'alpaca', 'static'] as const;
type MarketStatusProviderName = (typeof VALID_MARKET_STATUS_PROVIDERS)[number];

const VALID_MARKET_HOURS_MODES = ['disabled', 'pending', 'instant'] as const;
type MarketHoursMode = (typeof VALID_MARKET_HOURS_MODES)[number];

const VALID_NODE_ENVS = ['development', 'production', 'test'] as const;
type NodeEnv = (typeof VALID_NODE_ENVS)[number];

/**
 * Validates NODE_ENV against the known set. A bare cast would let a typo like
 * `prod` silently skip {@link validateProductionEnv} (which keys on an exact
 * `=== 'production'` match), shipping an unhardened process. Fail at boot instead.
 */
function validatedNodeEnv(): NodeEnv {
  const raw = optional('NODE_ENV', 'development');
  if (!(VALID_NODE_ENVS as readonly string[]).includes(raw)) {
    throw new Error(`Invalid NODE_ENV: "${raw}". Must be one of: ${VALID_NODE_ENVS.join(', ')}`);
  }
  return raw as NodeEnv;
}

function validatedMarketHoursMode(): MarketHoursMode {
  const raw = optional('MARKET_HOURS_MODE', 'instant');
  if (!(VALID_MARKET_HOURS_MODES as readonly string[]).includes(raw)) {
    throw new Error(
      `Invalid MARKET_HOURS_MODE: "${raw}". Must be one of: ${VALID_MARKET_HOURS_MODES.join(', ')}`,
    );
  }
  return raw as MarketHoursMode;
}

/**
 * Pick the market-status provider. Defaults to matching `STOCK_PROVIDER` when
 * unset, so swapping the price provider doesn't silently break the chart's
 * market-hours gating. When `STOCK_PROVIDER=mock`, defaults to `'static'`
 * (the market-status union has no `'mock'`). Operators can override to
 * `'static'` for an offline, key-less fallback at any time.
 */
function validatedMarketStatusProvider(stockProvider: StockProvider): MarketStatusProviderName {
  const raw = process.env.MARKET_STATUS_PROVIDER;
  if (!raw) return stockProvider === 'mock' ? 'static' : stockProvider;
  if (!(VALID_MARKET_STATUS_PROVIDERS as readonly string[]).includes(raw)) {
    throw new Error(
      `Invalid MARKET_STATUS_PROVIDER: "${raw}". Must be one of: ${VALID_MARKET_STATUS_PROVIDERS.join(', ')}`,
    );
  }
  return raw as MarketStatusProviderName;
}

const stockProvider = validatedProvider();

export const env = {
  DATABASE_URL: optional('DATABASE_URL', './dev.db'),
  JWT_SECRET: required('JWT_SECRET'),
  PORT: parsePort(optional('PORT', '3000')),
  CORS_ORIGIN: optional('CORS_ORIGIN', 'http://localhost:5173'),
  /**
   * Which upstream hops may set `X-Forwarded-For`. Feeds Fastify's `trustProxy`,
   * which decides `request.ip` — and `request.ip` is the key every per-route
   * rate limit is bucketed on, so trusting too much makes them all bypassable.
   *
   * Defaults to `loopback`: the shipped nginx site proxies from 127.0.0.1. The
   * container path puts nginx on a bridge network instead and sets
   * `uniquelocal` in `docker-compose.yml`. See {@link parseTrustProxy}.
   */
  TRUST_PROXY: parseTrustProxy(optional('TRUST_PROXY', 'loopback')),
  STOCK_PROVIDER: stockProvider,
  /**
   * Alpaca API key ID (the `APCA-API-KEY-ID` header). Falls back to the legacy
   * `ALPACA_API_KEY` name so existing configs keep working — that variable only
   * ever held the key ID. Pair with {@link env.ALPACA_API_SECRET_KEY}.
   */
  ALPACA_API_KEY_ID: optional('ALPACA_API_KEY_ID', optional('ALPACA_API_KEY', '')),
  /**
   * Alpaca API secret (the `APCA-API-SECRET-KEY` header). Required alongside the
   * key ID for any authenticated Alpaca call; without it every request is
   * rejected 401/403 by Alpaca.
   */
  ALPACA_API_SECRET_KEY: optional('ALPACA_API_SECRET_KEY', ''),
  MARKET_STATUS_PROVIDER: validatedMarketStatusProvider(stockProvider),
  MARKET_STATUS_CACHE_TTL_MS: parsePositiveInt(
    'MARKET_STATUS_CACHE_TTL_MS',
    optional('MARKET_STATUS_CACHE_TTL_MS', '60000'),
  ),
  NODE_ENV: validatedNodeEnv(),

  // Stock-data resilience tunables. All durations are in milliseconds.
  /** TTL for the `stock_price_cache` table. Cache hits skip the upstream fetch. */
  STOCK_CACHE_TTL_MS: parsePositiveInt('STOCK_CACHE_TTL_MS', optional('STOCK_CACHE_TTL_MS', '60000')),
  /** In-memory cache TTL for `searchSymbols` results, keyed by lowercased query. */
  STOCK_SEARCH_CACHE_TTL_MS: parsePositiveInt('STOCK_SEARCH_CACHE_TTL_MS', optional('STOCK_SEARCH_CACHE_TTL_MS', '300000')),
  /** In-memory cache TTL for `getHistory` results, keyed by (symbol, range). */
  STOCK_HISTORY_CACHE_TTL_MS: parsePositiveInt('STOCK_HISTORY_CACHE_TTL_MS', optional('STOCK_HISTORY_CACHE_TTL_MS', '60000')),
  /**
   * When the upstream is rate-limited, fall back to a cached quote if the row
   * is no older than this. Older rows propagate the RATE_LIMITED error.
   */
  STOCK_STALE_PRICE_MAX_AGE_MS: parsePositiveInt('STOCK_STALE_PRICE_MAX_AGE_MS', optional('STOCK_STALE_PRICE_MAX_AGE_MS', '300000')),
  /** After a 429, refuse upstream calls for this long (negative caching). */
  STOCK_RATE_LIMIT_BACKOFF_MS: parsePositiveInt('STOCK_RATE_LIMIT_BACKOFF_MS', optional('STOCK_RATE_LIMIT_BACKOFF_MS', '60000')),
  /**
   * If true, the trade endpoint executes orders at the most recent cached
   * price when the live quote is rate-limited. Default false — operators
   * who prefer fairness over availability should leave this off.
   */
  STOCK_ALLOW_STALE_TRADES: parseBool(optional('STOCK_ALLOW_STALE_TRADES', 'false')),
  /** Trades using a cached price older than this are rejected even when stale trades are allowed. */
  STOCK_STALE_TRADE_MAX_AGE_MS: parsePositiveInt('STOCK_STALE_TRADE_MAX_AGE_MS', optional('STOCK_STALE_TRADE_MAX_AGE_MS', '300000')),

  /**
   * Controls how the trade endpoint behaves when the market is closed.
   * - `instant`  — fill immediately at the last known price (legacy behavior, default).
   * - `disabled` — reject with 409 MARKET_CLOSED.
   * - `pending`  — accept the order, reserve cash/shares, settle at next market open.
   */
  MARKET_HOURS_MODE: validatedMarketHoursMode(),
  /** When true, PRE and POST sessions count as "open" for trading. */
  MARKET_HOURS_INCLUDE_EXTENDED: parseBool(optional('MARKET_HOURS_INCLUDE_EXTENDED', 'false')),
  /** How often the pending-orders worker checks for orders to settle, in ms. */
  PENDING_ORDERS_TICK_MS: parsePositiveInt(
    'PENDING_ORDERS_TICK_MS',
    optional('PENDING_ORDERS_TICK_MS', '30000'),
  ),
  /**
   * How often the portfolio-snapshot worker captures every active player's
   * total portfolio value. Default 5 minutes — aligns with the WS price-batch
   * cadence. Drives the leaderboard race chart and per-row sparklines.
   */
  PORTFOLIO_SNAPSHOT_INTERVAL_MS: parsePositiveInt(
    'PORTFOLIO_SNAPSHOT_INTERVAL_MS',
    optional('PORTFOLIO_SNAPSHOT_INTERVAL_MS', '300000'),
  ),

  /**
   * SQLite (libsql) busy-handler timeout in ms — how long a writer waits for a
   * contended lock before failing with SQLITE_BUSY. Set as a per-connection
   * `PRAGMA busy_timeout` at startup (covers reads/conn0) and re-applied before
   * each write by the seed tool (`db-busy.ts`), because libsql resets it to 0
   * on every fresh connection it spawns after a transaction. Ignored under PG.
   */
  SQLITE_BUSY_TIMEOUT_MS: parsePositiveInt(
    'SQLITE_BUSY_TIMEOUT_MS',
    optional('SQLITE_BUSY_TIMEOUT_MS', '5000'),
  ),

  /**
   * Consecutive failed logins for one username before `POST /auth/login` starts
   * answering 429 for {@link env.LOGIN_LOCKOUT_MS}. Counted per account rather
   * than per IP so the control survives an attacker rotating source addresses.
   */
  LOGIN_MAX_FAILED_ATTEMPTS: parsePositiveInt(
    'LOGIN_MAX_FAILED_ATTEMPTS',
    optional('LOGIN_MAX_FAILED_ATTEMPTS', '10'),
  ),
  /** Failures older than this stop counting toward the threshold. */
  LOGIN_FAILURE_WINDOW_MS: parsePositiveInt(
    'LOGIN_FAILURE_WINDOW_MS',
    optional('LOGIN_FAILURE_WINDOW_MS', '900000'),
  ),
  /**
   * How long an account stays throttled once the threshold trips. Kept short on
   * purpose: anyone can trigger it for any username, so a long value would hand
   * an attacker a denial-of-service against a chosen account.
   */
  LOGIN_LOCKOUT_MS: parsePositiveInt('LOGIN_LOCKOUT_MS', optional('LOGIN_LOCKOUT_MS', '900000')),

  /**
   * Base OTLP/HTTP endpoint of an OpenTelemetry Collector, e.g.
   * `http://localhost:4318`. Empty disables telemetry entirely — no exporters
   * are constructed and no connection is attempted. Signal paths (`/v1/traces`
   * and friends) are appended by {@link initTelemetry}, so do not include one.
   *
   * Other standard `OTEL_*` variables (`OTEL_TRACES_SAMPLER`,
   * `OTEL_EXPORTER_OTLP_HEADERS`, …) are read by the SDK itself and are
   * deliberately not mirrored here.
   */
  OTEL_EXPORTER_OTLP_ENDPOINT: optional('OTEL_EXPORTER_OTLP_ENDPOINT', ''),
  /** `service.name` on every emitted span, metric, and log record. */
  OTEL_SERVICE_NAME: optional('OTEL_SERVICE_NAME', 'markettrader-server'),
  /** How often the metric reader pushes to the collector, in ms. */
  OTEL_METRIC_EXPORT_INTERVAL_MS: parsePositiveInt(
    'OTEL_METRIC_EXPORT_INTERVAL_MS',
    optional('OTEL_METRIC_EXPORT_INTERVAL_MS', '60000'),
  ),
  /**
   * Minimum pino level shipped over OTLP. Records below it still reach stdout
   * (and therefore journald) — this only trims what crosses the network.
   */
  OTEL_LOG_LEVEL_MIN: optional('OTEL_LOG_LEVEL_MIN', 'info'),
} as const;

/** True when an OTLP endpoint is configured. Everything telemetry keys off this. */
export const telemetryEnabled = env.OTEL_EXPORTER_OTLP_ENDPOINT !== '';

export interface ProductionEnvCheck {
  JWT_SECRET: string;
  CORS_ORIGIN: string;
  DATABASE_URL: string;
  TRUST_PROXY: boolean | number | string;
  STOCK_PROVIDER: string;
  MARKET_STATUS_PROVIDER: string;
  ALPACA_API_KEY_ID: string;
  ALPACA_API_SECRET_KEY: string;
  OTEL_EXPORTER_OTLP_ENDPOINT: string;
}

// Remote libsql endpoints are durable servers, not local files. Mirrors the
// schemes accepted by normalizeLibsqlUrl in db/index.ts — keep the two in sync.
const REMOTE_DB_SCHEMES = ['libsql:', 'http:', 'https:', 'ws:', 'wss:'];

/**
 * True when `url` names a database that survives a process restart. Postgres and
 * remote libsql qualify; a SQLite file qualifies only at an absolute path.
 *
 * Both rejected forms lose data silently rather than failing loudly: an
 * in-memory database is discarded on every restart, and a CWD-relative path
 * resolves against `process.cwd()`, so launching from a different directory
 * opens a fresh, empty file and migrates it into a working-looking app.
 */
function isDurableProductionDatabase(url: string): boolean {
  if (url.startsWith('postgres')) return true;
  if (REMOTE_DB_SCHEMES.some((scheme) => url.startsWith(scheme))) return true;
  // Catches bare ':memory:' and the 'file::memory:?cache=shared' form that
  // normalizeLibsqlUrl expands it into.
  if (url.includes(':memory:')) return false;
  const filePath = url.startsWith('file:') ? url.slice('file:'.length) : url;
  return path.isAbsolute(filePath);
}

/**
 * Enforces production-only invariants that are too costly to require during
 * dev/test (a real JWT secret, a durable database). Collects every failure and
 * throws once, so the process exits before binding the port.
 *
 * Each check targets config that would otherwise fail at *request* time, long
 * after a seemingly successful boot.
 *
 * Intended caller: `src/index.ts`, only when `NODE_ENV === 'production'`.
 * The config is passed in (not pulled from {@link env}) so the function is
 * pure and trivially unit-testable.
 */
export function validateProductionEnv(cfg: ProductionEnvCheck = env): void {
  const errors: string[] = [];

  if (cfg.JWT_SECRET.length < 32) {
    errors.push(
      `JWT_SECRET must be at least 32 characters in production (got ${cfg.JWT_SECRET.length}).`,
    );
  }

  if (cfg.CORS_ORIGIN === 'http://localhost:5173') {
    errors.push(
      'CORS_ORIGIN must be set to your production frontend URL; the dev default is not allowed.',
    );
  }

  // Trusting every hop makes request.ip the leftmost X-Forwarded-For entry —
  // a value the client writes. Since that is the default rate-limit key, it
  // lifts the cap on every throttled route, login included.
  if (cfg.TRUST_PROXY === true) {
    errors.push(
      'TRUST_PROXY must not be true in production: it trusts every hop, so a client-supplied ' +
        'X-Forwarded-For becomes request.ip and every per-IP rate limit is bypassable. ' +
        'Use "loopback", "uniquelocal", a hop count, or an explicit address list.',
    );
  }

  if (!isDurableProductionDatabase(cfg.DATABASE_URL)) {
    errors.push(
      'DATABASE_URL must point at a durable database in production: a postgres:// URL, ' +
        'a remote libsql URL, or an absolute path to a SQLite file. ' +
        'In-memory and CWD-relative databases lose data silently.',
    );
  }

  // Either provider being set to alpaca needs a full key pair — a missing
  // secret silently 401s every upstream call.
  const usesAlpaca = cfg.STOCK_PROVIDER === 'alpaca' || cfg.MARKET_STATUS_PROVIDER === 'alpaca';
  if (usesAlpaca && (!cfg.ALPACA_API_KEY_ID || !cfg.ALPACA_API_SECRET_KEY)) {
    errors.push(
      'Alpaca (STOCK_PROVIDER or MARKET_STATUS_PROVIDER) requires both ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY.',
    );
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid production environment:\n  - ${errors.join('\n  - ')}`,
    );
  }

  if (!cfg.OTEL_EXPORTER_OTLP_ENDPOINT) {
    // Non-fatal: surface the gap so operators see it once at boot. Logs still
    // reach journald; what's missing is traces, metrics, and any alerting.
    console.warn(
      '[env] OTEL_EXPORTER_OTLP_ENDPOINT not set — no traces, metrics, or logs will be exported.',
    );
  }
}
