// TODO(polygon-provider): add 'polygon' once PolygonProvider is implemented
const VALID_PROVIDERS = ['yahoo', 'alpaca'] as const;
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

/**
 * Pick the market-status provider. Defaults to matching `STOCK_PROVIDER` when
 * unset, so swapping the price provider doesn't silently break the chart's
 * market-hours gating. Operators can override to `static` for an offline,
 * key-less fallback at any time.
 */
function validatedMarketStatusProvider(stockProvider: StockProvider): MarketStatusProviderName {
  const raw = process.env.MARKET_STATUS_PROVIDER;
  if (!raw) return stockProvider;
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
  ALPACA_API_KEY: optional('ALPACA_API_KEY', ''),
  MARKET_STATUS_PROVIDER: validatedMarketStatusProvider(stockProvider),
  MARKET_STATUS_CACHE_TTL_MS: parsePositiveInt(
    'MARKET_STATUS_CACHE_TTL_MS',
    optional('MARKET_STATUS_CACHE_TTL_MS', '60000'),
  ),
  NODE_ENV: optional('NODE_ENV', 'development') as 'development' | 'production' | 'test',

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
} as const;
