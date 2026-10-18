import path from 'node:path';
import { isAddressOrSubnet, validateCidrList } from './limits/cidr.js';

// TODO(polygon-provider): add 'polygon' once PolygonProvider is implemented
export const VALID_PROVIDERS = ['yahoo', 'alpaca', 'mock'] as const;
type StockProvider = (typeof VALID_PROVIDERS)[number];

// Names present in the process environment at boot, even if empty. Lets the
// admin panel tell "set by the host" from "built-in default" without any other
// module reading process.env.
const explicitlySet = new Set<string>();

function read(name: string): string | undefined {
  const value = process.env[name];
  if (value !== undefined) explicitlySet.add(name);
  return value;
}

function optional(name: string, fallback: string): string {
  return read(name) ?? fallback;
}

function required(name: string): string {
  const value = read(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/** True when `name` was present in the process environment at boot, even if empty. */
export function wasSetInEnvironment(name: string): boolean {
  return explicitlySet.has(name);
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

function parseNonNegativeInt(name: string, raw: string): number {
  const n = parseInt(raw, 10);
  if (isNaN(n) || n < 0) {
    throw new Error(`Invalid ${name}: "${raw}". Must be a non-negative integer.`);
  }
  return n;
}

function parseBool(raw: string): boolean {
  return raw.trim().toLowerCase() === 'true';
}

/** Reads a comma-separated IP/CIDR list, failing at boot on any malformed entry. */
function validatedCidrList(name: string): string {
  const raw = optional(name, '').trim();
  const problem = validateCidrList(raw);
  if (problem) throw new Error(`Invalid ${name}: ${problem}.`);
  return raw;
}

/**
 * Problem with an OpenRouter model id (`vendor/model`, optional `:variant`), or
 * undefined when valid. Shared with the admin panel's override check.
 */
export function validateModelSlug(value: string): string | undefined {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9._:-]+$/.test(value) && value.length <= 100
    ? undefined
    : 'Must be an OpenRouter model id such as openrouter/free or vendor/model:variant.';
}

function validatedModelSlug(name: string, fallback: string): string {
  const raw = optional(name, fallback).trim();
  const problem = validateModelSlug(raw);
  if (problem) throw new Error(`Invalid ${name}: "${raw}". ${problem}`);
  return raw;
}

/** Named address ranges `proxy-addr` understands, accepted verbatim by Fastify. */
const TRUST_PROXY_PRESETS = ['loopback', 'linklocal', 'uniquelocal'] as const;

/**
 * Parses `TRUST_PROXY` into Fastify's `trustProxy` option: `false`, a
 * {@link TRUST_PROXY_PRESETS} name, or a comma-separated list of addresses and
 * CIDR subnets.
 *
 * Anything Fastify would accept but that is not one of those forms is rejected
 * here rather than at request time. `proxy-addr` compiles its trust list lazily,
 * so a typo would otherwise boot cleanly and only misresolve `request.ip` under
 * traffic — which silently keys every rate limit on the wrong value. A hop count
 * is refused for the same reason: Fastify >= 5.12.7 treats one as trusting nothing.
 *
 * `true` parses (some operators genuinely front the app with a chain they
 * control) but {@link validateProductionEnv} refuses it in production.
 */
export function parseTrustProxy(raw: string): boolean | string {
  const value = raw.trim();
  if (value === '' || value.toLowerCase() === 'false') return false;
  if (value.toLowerCase() === 'true') return true;
  if (/^\d+$/.test(value)) {
    throw new Error(
      `Invalid TRUST_PROXY: "${raw}". A hop count is not supported: Fastify treats it as ` +
        `trusting nothing, so every client behind the proxy would share one rate-limit ` +
        `bucket. Use loopback, uniquelocal, or the proxy's IP address or CIDR subnet.`,
    );
  }

  const tokens = value.split(',').map((t) => t.trim());
  const valid = tokens.every(
    (t) =>
      (TRUST_PROXY_PRESETS as readonly string[]).includes(t) || isAddressOrSubnet(t),
  );
  if (!valid) {
    throw new Error(
      `Invalid TRUST_PROXY: "${raw}". Must be true, false, ` +
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

export const VALID_MARKET_STATUS_PROVIDERS = ['yahoo', 'alpaca', 'static'] as const;
type MarketStatusProviderName = (typeof VALID_MARKET_STATUS_PROVIDERS)[number];

export const VALID_MARKET_HOURS_MODES = ['disabled', 'pending', 'instant'] as const;
type MarketHoursMode = (typeof VALID_MARKET_HOURS_MODES)[number];

export const VALID_NODE_ENVS = ['development', 'production', 'test'] as const;
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
  const raw = read('MARKET_STATUS_PROVIDER');
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
  /**
   * OpenRouter API key for LLM stock analysis. Empty turns the feature off: the
   * endpoints answer 503 and the Analyze button is hidden. Never a boot failure.
   */
  OPENROUTER_API_KEY: optional('OPENROUTER_API_KEY', ''),
  NODE_ENV: validatedNodeEnv(),

  /**
   * How often the server sends WebSocket ping frames to connected clients, in
   * ms. Must stay comfortably below the shortest idle timeout on the path
   * (reverse-proxy `proxy_read_timeout`, NAT tables): a socket reaped by an
   * intermediary tells neither end, which strands the server entry and puts
   * the browser into a reconnect loop. A client that misses one ping is
   * terminated.
   */
  WS_HEARTBEAT_INTERVAL_MS: parsePositiveInt(
    'WS_HEARTBEAT_INTERVAL_MS',
    optional('WS_HEARTBEAT_INTERVAL_MS', '30000'),
  ),

  /**
   * How often live sockets are re-checked against the database, in ms. A
   * socket's authorization is otherwise decided once at upgrade, so this bounds
   * how long a revoked membership, a disabled account, or an expired token
   * keeps receiving a game's event stream.
   */
  WS_REVALIDATE_INTERVAL_MS: parsePositiveInt(
    'WS_REVALIDATE_INTERVAL_MS',
    optional('WS_REVALIDATE_INTERVAL_MS', '30000'),
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

  /**
   * PostHog project token (`phc_…`). With {@link env.POSTHOG_HOST} it turns on
   * server-side product analytics, error tracking, and log export; either one
   * empty leaves all three off. A project token is write-only by design, so it
   * is not treated as a secret by PostHog — but it still lives in env, not code.
   */
  POSTHOG_KEY: optional('POSTHOG_KEY', ''),
  /** PostHog ingestion host, e.g. `https://us.i.posthog.com`. Not the app URL. */
  POSTHOG_HOST: optional('POSTHOG_HOST', ''),
  /**
   * Minimum pino level exported to PostHog Logs. Separate from
   * {@link env.OTEL_LOG_LEVEL_MIN} and stricter by default: PostHog bills logs
   * by volume, and Fastify writes two info lines per request.
   */
  POSTHOG_LOG_LEVEL_MIN: optional('POSTHOG_LOG_LEVEL_MIN', 'warn'),
} as const;

/**
 * Boot values of the options an admin may override from `/admin/config`. Read
 * them through an injected `ConfigReader` so an override reaches the consumer;
 * only `config/runtime-config.ts` may import this (enforced by eslint). Moving a
 * property here from {@link env} makes the compiler list every consumer to update.
 */
export const liveBootConfig = {
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
   * How often the Discover worker checks for missing lists: market movers for
   * the session that just closed, and daily picks for games without one.
   * Default 5 minutes — bounds how long a new game shows "preparing", and how
   * soon after the 16:00 ET close the movers are captured.
   */
  DISCOVER_REFRESH_INTERVAL_MS: parsePositiveInt(
    'DISCOVER_REFRESH_INTERVAL_MS',
    optional('DISCOVER_REFRESH_INTERVAL_MS', '300000'),
  ),

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

  /** Symbols one watchlist may hold. Adds past it are refused with 409. */
  WATCHLIST_MAX_ITEMS: parsePositiveInt(
    'WATCHLIST_MAX_ITEMS',
    optional('WATCHLIST_MAX_ITEMS', '50'),
  ),
  /** Watchlists one user may own. Creates past it are refused with 409. */
  WATCHLIST_MAX_PER_USER: parsePositiveInt(
    'WATCHLIST_MAX_PER_USER',
    optional('WATCHLIST_MAX_PER_USER', '20'),
  ),
  /** Largest `startingBalance` a player may give a new game. Bounds the featured-games ranking input. */
  GAME_MAX_STARTING_BALANCE: parsePositiveInt(
    'GAME_MAX_STARTING_BALANCE',
    optional('GAME_MAX_STARTING_BALANCE', '10000000'),
  ),
  /** Longest a new game may run, in days. Workers write rows for every live game, so open-ended games are unbounded cost. */
  GAME_MAX_DURATION_DAYS: parsePositiveInt(
    'GAME_MAX_DURATION_DAYS',
    optional('GAME_MAX_DURATION_DAYS', '365'),
  ),
  /** How far in the future a new game's start date may be, in days. */
  GAME_MAX_START_DELAY_DAYS: parseNonNegativeInt(
    'GAME_MAX_START_DELAY_DAYS',
    optional('GAME_MAX_START_DELAY_DAYS', '90'),
  ),
  /** Most players one game may hold. Joins past it are refused with 409 GAME_FULL. */
  GAME_MAX_PLAYERS: parsePositiveInt('GAME_MAX_PLAYERS', optional('GAME_MAX_PLAYERS', '100')),

  // Per-user limits. Each LIMIT_* value is the global ceiling for a mature
  // account on an ordinary connection; see limits/catalogue.ts for what each
  // one counts and limits/resolver.ts for probation and the privileged multiplier.
  /** Master switch. False lifts every limit in limits/catalogue.ts. */
  LIMITS_ENABLED: parseBool(optional('LIMITS_ENABLED', 'true')),
  /** Days a new account runs on reduced limits. 0 turns probation off. */
  LIMITS_MATURITY_DAYS: parseNonNegativeInt(
    'LIMITS_MATURITY_DAYS',
    optional('LIMITS_MATURITY_DAYS', '7'),
  ),
  /** Share of each limit an account on probation gets, rounded up, never below 1. */
  LIMITS_PROBATION_PERCENT: parsePositiveInt(
    'LIMITS_PROBATION_PERCENT',
    optional('LIMITS_PROBATION_PERCENT', '25'),
  ),
  /**
   * Comma-separated IPs and CIDR subnets (an office) whose requests get
   * {@link liveBootConfig.LIMITS_PRIVILEGED_MULTIPLIER} on every limit. Matched
   * against `request.ip`, so it is only as trustworthy as TRUST_PROXY.
   */
  LIMITS_PRIVILEGED_CIDRS: validatedCidrList('LIMITS_PRIVILEGED_CIDRS'),
  /** Factor applied to every limit for a privileged connection. */
  LIMITS_PRIVILEGED_MULTIPLIER: parsePositiveInt(
    'LIMITS_PRIVILEGED_MULTIPLIER',
    optional('LIMITS_PRIVILEGED_MULTIPLIER', '10'),
  ),
  /** Authenticated REST requests per user per minute, across every route. */
  LIMIT_API_REQUESTS_PER_MINUTE: parsePositiveInt(
    'LIMIT_API_REQUESTS_PER_MINUTE',
    optional('LIMIT_API_REQUESTS_PER_MINUTE', '600'),
  ),
  /** Orders placed per user per minute. */
  LIMIT_TRADES_PER_MINUTE: parsePositiveInt(
    'LIMIT_TRADES_PER_MINUTE',
    optional('LIMIT_TRADES_PER_MINUTE', '60'),
  ),
  /** Order cancellations (working and pending) per user per minute. */
  LIMIT_ORDER_CANCELS_PER_MINUTE: parsePositiveInt(
    'LIMIT_ORDER_CANCELS_PER_MINUTE',
    optional('LIMIT_ORDER_CANCELS_PER_MINUTE', '60'),
  ),
  /** Invite-code lookups per user per minute; bounds code enumeration. */
  LIMIT_CODE_LOOKUPS_PER_MINUTE: parsePositiveInt(
    'LIMIT_CODE_LOOKUPS_PER_MINUTE',
    optional('LIMIT_CODE_LOOKUPS_PER_MINUTE', '20'),
  ),
  /** WebSocket `subscribe` frames per user per minute, across sockets. */
  LIMIT_WS_SUBSCRIBES_PER_MINUTE: parsePositiveInt(
    'LIMIT_WS_SUBSCRIBES_PER_MINUTE',
    optional('LIMIT_WS_SUBSCRIBES_PER_MINUTE', '30'),
  ),
  /** Games one user may create in any rolling 7 days. */
  LIMIT_GAMES_CREATED_PER_WEEK: parsePositiveInt(
    'LIMIT_GAMES_CREATED_PER_WEEK',
    optional('LIMIT_GAMES_CREATED_PER_WEEK', '10'),
  ),
  /** Games one user may own that have not ended. */
  LIMIT_ACTIVE_GAMES_OWNED: parsePositiveInt(
    'LIMIT_ACTIVE_GAMES_OWNED',
    optional('LIMIT_ACTIVE_GAMES_OWNED', '5'),
  ),
  /** Games one user may join (including ones they create) in any rolling 24 hours. */
  LIMIT_GAMES_JOINED_PER_DAY: parsePositiveInt(
    'LIMIT_GAMES_JOINED_PER_DAY',
    optional('LIMIT_GAMES_JOINED_PER_DAY', '20'),
  ),
  /** Games one user may be in that have not ended. */
  LIMIT_ACTIVE_GAMES_JOINED: parsePositiveInt(
    'LIMIT_ACTIVE_GAMES_JOINED',
    optional('LIMIT_ACTIVE_GAMES_JOINED', '30'),
  ),
  /** Working plus pending orders one player may have open in one game. */
  LIMIT_OPEN_ORDERS_PER_PLAYER: parsePositiveInt(
    'LIMIT_OPEN_ORDERS_PER_PLAYER',
    optional('LIMIT_OPEN_ORDERS_PER_PLAYER', '50'),
  ),
  /** Live sockets one user may hold open across both WebSocket routes. */
  LIMIT_WS_CONNECTIONS_PER_USER: parsePositiveInt(
    'LIMIT_WS_CONNECTIONS_PER_USER',
    optional('LIMIT_WS_CONNECTIONS_PER_USER', '10'),
  ),
  /** Accounts that may be registered from one IP in any rolling 24 hours. */
  LIMIT_REGISTRATIONS_PER_IP_PER_DAY: parsePositiveInt(
    'LIMIT_REGISTRATIONS_PER_IP_PER_DAY',
    optional('LIMIT_REGISTRATIONS_PER_IP_PER_DAY', '5'),
  ),
  /** Fresh stock analyses one user may generate in any rolling 24 hours. Cached views are free. */
  LIMIT_STOCK_ANALYSES_PER_DAY: parsePositiveInt(
    'LIMIT_STOCK_ANALYSES_PER_DAY',
    optional('LIMIT_STOCK_ANALYSES_PER_DAY', '10'),
  ),

  // Stock analysis (LLM via OpenRouter). Off unless OPENROUTER_API_KEY is set.
  /** OpenRouter model id. Part of the cache key, so changing it starts a fresh cache. */
  ANALYSIS_MODEL: validatedModelSlug('ANALYSIS_MODEL', 'openrouter/free'),
  /** How long one analysis is served to every user before the next request regenerates it. */
  ANALYSIS_CACHE_TTL_MS: parsePositiveInt(
    'ANALYSIS_CACHE_TTL_MS',
    optional('ANALYSIS_CACHE_TTL_MS', '86400000'),
  ),
  /**
   * Abort an LLM call after this long. Free models routinely take 15–60 s, so a
   * generation outlives its request: see ANALYSIS_RESPONSE_WAIT_MS.
   */
  ANALYSIS_TIMEOUT_MS: parsePositiveInt(
    'ANALYSIS_TIMEOUT_MS',
    optional('ANALYSIS_TIMEOUT_MS', '90000'),
  ),
  /**
   * How long `POST /stocks/:symbol/analysis` waits for a generation before
   * answering 202 and letting the client poll. Must stay under the reverse
   * proxy's read timeout (nginx defaults to 60 s).
   */
  ANALYSIS_RESPONSE_WAIT_MS: parsePositiveInt(
    'ANALYSIS_RESPONSE_WAIT_MS',
    optional('ANALYSIS_RESPONSE_WAIT_MS', '25000'),
  ),
  /**
   * Global ceiling on LLM calls in any rolling 24 hours, failures included. A
   * spend backstop rather than a per-user limit, so admins and
   * LIMITS_ENABLED=false are still bound by it. 50 matches OpenRouter's
   * free-model daily cap for accounts without purchased credits.
   */
  ANALYSIS_MAX_GENERATIONS_PER_DAY: parsePositiveInt(
    'ANALYSIS_MAX_GENERATIONS_PER_DAY',
    optional('ANALYSIS_MAX_GENERATIONS_PER_DAY', '50'),
  ),
  /** Days analysis rows (and who requested each) are kept before pruning. */
  ANALYSIS_RETENTION_DAYS: parsePositiveInt(
    'ANALYSIS_RETENTION_DAYS',
    optional('ANALYSIS_RETENTION_DAYS', '30'),
  ),

  /**
   * Hard cap on how many distinct symbols one price-poller tick may fetch.
   * The poller's symbol set is assembled from user-controlled rows (holdings,
   * open orders, watchlists) and the provider it drains is process-wide, so an
   * unbounded set lets one account's row count degrade prices for everyone.
   * Symbols are prioritised holdings → open orders → watchlists, so anything
   * dropped at the cap is display-only. Truncation is logged.
   */
  PRICE_POLLER_MAX_SYMBOLS: parsePositiveInt(
    'PRICE_POLLER_MAX_SYMBOLS',
    optional('PRICE_POLLER_MAX_SYMBOLS', '500'),
  ),
  /**
   * How often the usage-rollup worker writes the in-memory request and denial
   * counts to `api_usage_hourly` / `limit_denials_hourly`. A crash loses at most
   * one interval of counts — monitoring data, never enforcement state.
   */
  USAGE_FLUSH_INTERVAL_MS: parsePositiveInt(
    'USAGE_FLUSH_INTERVAL_MS',
    optional('USAGE_FLUSH_INTERVAL_MS', '60000'),
  ),
  /** Days of hourly usage and denial rows kept for the admin panel. */
  USAGE_RETENTION_DAYS: parsePositiveInt(
    'USAGE_RETENTION_DAYS',
    optional('USAGE_RETENTION_DAYS', '30'),
  ),
  /** How long the market open/closed state is cached, in ms. */
  MARKET_STATUS_CACHE_TTL_MS: parsePositiveInt(
    'MARKET_STATUS_CACHE_TTL_MS',
    optional('MARKET_STATUS_CACHE_TTL_MS', '60000'),
  ),

  /**
   * Consecutive failed logins for one username before `POST /auth/login` starts
   * answering 429 for {@link liveBootConfig.LOGIN_LOCKOUT_MS}. Counted per account rather
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
} as const;

/** True when an OTLP endpoint is configured. Everything telemetry keys off this. */
export const telemetryEnabled = env.OTEL_EXPORTER_OTLP_ENDPOINT !== '';

/** True when both PostHog vars are set. Unset is silently off, like {@link telemetryEnabled}. */
export const posthogEnabled = env.POSTHOG_KEY !== '' && env.POSTHOG_HOST !== '';

export interface ProductionEnvCheck {
  JWT_SECRET: string;
  CORS_ORIGIN: string;
  DATABASE_URL: string;
  TRUST_PROXY: boolean | string;
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
 * True when `url` points at a server rather than a local file — Postgres or
 * remote libsql. Such a URL is durable whatever its content, which is why every
 * caller tests it before any substring match: a password containing `:memory:`
 * must not make a real database look ephemeral.
 */
export function isRemoteDatabaseUrl(url: string): boolean {
  if (url.startsWith('postgres')) return true;
  return REMOTE_DB_SCHEMES.some((scheme) => url.startsWith(scheme));
}

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
  if (isRemoteDatabaseUrl(url)) return true;
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
        'Use "loopback", "uniquelocal", or an explicit address list.',
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
