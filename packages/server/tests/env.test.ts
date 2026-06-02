import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { validateProductionEnv, type ProductionEnvCheck } from '../src/env.js';

const valid: ProductionEnvCheck = {
  JWT_SECRET: 'a'.repeat(32),
  CORS_ORIGIN: 'https://prod.example.com',
  DATABASE_URL: 'postgres://user:pw@db:5432/markettrader',
  STOCK_PROVIDER: 'yahoo',
  MARKET_STATUS_PROVIDER: 'yahoo',
  ALPACA_API_KEY_ID: '',
  ALPACA_API_SECRET_KEY: '',
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

  it('requires the Alpaca key pair when STOCK_PROVIDER=alpaca', () => {
    expect(() =>
      validateProductionEnv({ ...valid, STOCK_PROVIDER: 'alpaca' }),
    ).toThrow(/ALPACA_API_KEY_ID/);
  });

  it('requires the Alpaca key pair when MARKET_STATUS_PROVIDER=alpaca', () => {
    // Regression: the market-status factory used to skip this check, so a
    // boot with MARKET_STATUS_PROVIDER=alpaca and no key only failed at request
    // time with an opaque 502.
    expect(() =>
      validateProductionEnv({ ...valid, MARKET_STATUS_PROVIDER: 'alpaca' }),
    ).toThrow(/ALPACA_API_SECRET_KEY/);
  });

  it('rejects alpaca with only the key id and no secret', () => {
    expect(() =>
      validateProductionEnv({ ...valid, STOCK_PROVIDER: 'alpaca', ALPACA_API_KEY_ID: 'k' }),
    ).toThrow(/ALPACA_API_SECRET_KEY/);
  });

  it('accepts alpaca provider when the full key pair is set', () => {
    expect(() =>
      validateProductionEnv({
        ...valid,
        STOCK_PROVIDER: 'alpaca',
        ALPACA_API_KEY_ID: 'k',
        ALPACA_API_SECRET_KEY: 's',
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
        MARKET_STATUS_PROVIDER: 'yahoo',
        ALPACA_API_KEY_ID: '',
        ALPACA_API_SECRET_KEY: '',
        SENTRY_DSN: '',
      }),
    ).toThrow(/JWT_SECRET[\s\S]*CORS_ORIGIN[\s\S]*DATABASE_URL[\s\S]*ALPACA/);
  });
});

describe('env', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('accepts STOCK_PROVIDER=mock', async () => {
    vi.stubEnv('STOCK_PROVIDER', 'mock');
    vi.stubEnv('DATABASE_URL', ':memory:');
    vi.stubEnv('JWT_SECRET', 'x'.repeat(32));
    const mod = await import('../src/env.js');
    expect(mod.env.STOCK_PROVIDER).toBe('mock');
  });
});
