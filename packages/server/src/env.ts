const VALID_PROVIDERS = ['yahoo', 'alpaca', 'polygon'] as const;
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

function validatedProvider(): StockProvider {
  const value = optional('STOCK_PROVIDER', 'yahoo');
  if (!(VALID_PROVIDERS as readonly string[]).includes(value)) {
    throw new Error(
      `Invalid STOCK_PROVIDER: "${value}". Must be one of: ${VALID_PROVIDERS.join(', ')}`,
    );
  }
  return value as StockProvider;
}

export const env = {
  DATABASE_URL: optional('DATABASE_URL', './dev.db'),
  JWT_SECRET: required('JWT_SECRET'),
  PORT: parsePort(optional('PORT', '3000')),
  CORS_ORIGIN: optional('CORS_ORIGIN', 'http://localhost:5173'),
  STOCK_PROVIDER: validatedProvider(),
  NODE_ENV: optional('NODE_ENV', 'development') as 'development' | 'production' | 'test',
} as const;
