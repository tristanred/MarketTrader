import { describe, it, expect } from 'vitest';
import { validateProductionEnv, type ProductionEnvCheck } from '../src/env.js';

const valid: ProductionEnvCheck = {
  JWT_SECRET: 'a'.repeat(32),
  CORS_ORIGIN: 'https://prod.example.com',
  DATABASE_URL: 'postgres://user:pw@db:5432/markettrader',
  STOCK_PROVIDER: 'yahoo',
  ALPACA_API_KEY: '',
  SENTRY_DSN: 'https://public@sentry.io/1',
};

describe('validateProductionEnv', () => {
  it('accepts a fully valid production config', () => {
    expect(() => validateProductionEnv(valid)).not.toThrow();
  });

  it('rejects a JWT_SECRET shorter than 32 chars', () => {
    expect(() => validateProductionEnv({ ...valid, JWT_SECRET: 'short' }))
      .toThrow(/JWT_SECRET/);
  });

  it('rejects the dev-default CORS_ORIGIN', () => {
    expect(() =>
      validateProductionEnv({ ...valid, CORS_ORIGIN: 'http://localhost:5173' }),
    ).toThrow(/CORS_ORIGIN/);
  });

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => validateProductionEnv({ ...valid, DATABASE_URL: './dev.db' }))
      .toThrow(/DATABASE_URL/);
  });

  it('requires ALPACA_API_KEY when STOCK_PROVIDER=alpaca', () => {
    expect(() =>
      validateProductionEnv({ ...valid, STOCK_PROVIDER: 'alpaca', ALPACA_API_KEY: '' }),
    ).toThrow(/ALPACA_API_KEY/);
  });

  it('accepts alpaca provider when an API key is set', () => {
    expect(() =>
      validateProductionEnv({
        ...valid,
        STOCK_PROVIDER: 'alpaca',
        ALPACA_API_KEY: 'k',
      }),
    ).not.toThrow();
  });

  it('reports all errors at once', () => {
    expect(() =>
      validateProductionEnv({
        JWT_SECRET: 'x',
        CORS_ORIGIN: 'http://localhost:5173',
        DATABASE_URL: ':memory:',
        STOCK_PROVIDER: 'alpaca',
        ALPACA_API_KEY: '',
        SENTRY_DSN: '',
      }),
    ).toThrow(/JWT_SECRET[\s\S]*CORS_ORIGIN[\s\S]*DATABASE_URL[\s\S]*ALPACA_API_KEY/);
  });
});
