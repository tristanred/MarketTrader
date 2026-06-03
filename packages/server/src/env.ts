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
   * Sentry DSN. When set, the server initializes @sentry/node and forwards
   * 5xx errors to Sentry. Empty string disables Sentry entirely (no-op).
   */
  SENTRY_DSN: optional('SENTRY_DSN', ''),
} as const;

export interface ProductionEnvCheck {
  JWT_SECRET: string;
  CORS_ORIGIN: string;
  DATABASE_URL: string;
  STOCK_PROVIDER: string;
  MARKET_STATUS_PROVIDER: string;
  ALPACA_API_KEY_ID: string;
  ALPACA_API_SECRET_KEY: string;
  SENTRY_DSN: string;
}

/**
 * Enforces production-only invariants that are too costly to require during
 * dev/test (e.g., refusing SQLite, demanding a real JWT secret). Throws on
 * the first failure so the process exits before binding the port.
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

  if (!cfg.DATABASE_URL.startsWith('postgres')) {
    errors.push('DATABASE_URL must be a postgres:// connection string in production.');
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

  if (!cfg.SENTRY_DSN) {
    // Non-fatal: surface the gap so operators see it once at boot.
    console.warn('[env] SENTRY_DSN not set — runtime errors will not be reported.');
  }
}
