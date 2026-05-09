function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const env = {
  DATABASE_URL: optional('DATABASE_URL', './dev.db'),
  JWT_SECRET: optional('JWT_SECRET', 'dev-secret-change-in-production'),
  PORT: parseInt(optional('PORT', '3000'), 10),
  CORS_ORIGIN: optional('CORS_ORIGIN', 'http://localhost:5173'),
  STOCK_PROVIDER: optional('STOCK_PROVIDER', 'yahoo') as 'yahoo' | 'alpaca' | 'polygon',
  NODE_ENV: optional('NODE_ENV', 'development') as 'development' | 'production' | 'test',
} as const;
