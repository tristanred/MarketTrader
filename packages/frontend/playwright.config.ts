import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  retries: 1,
  reporter: [['line'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    headless: true,
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'pnpm --filter @markettrader/server exec tsx src/index.ts',
      url: 'http://127.0.0.1:3000/health',
      reuseExistingServer: false,
      timeout: 60_000,
      cwd: '../..',
      env: {
        // libsql opens a fresh per-connection in-memory DB for plain ':memory:',
        // so migrations applied during startup are invisible to subsequent query
        // connections. The `file::memory:?cache=shared` URI shares one DB across
        // all connections in the process.
        DATABASE_URL: 'file::memory:?cache=shared',
        JWT_SECRET: 'e2e-test-secret-key-for-playwright-only-not-prod',
        CORS_ORIGIN: 'http://127.0.0.1:5173',
        PORT: '3000',
        NODE_ENV: 'test',
        STOCK_PROVIDER: 'mock',
        MARKET_STATUS_PROVIDER: 'static',
        MARKET_HOURS_MODE: 'instant',
      },
    },
    {
      command: 'pnpm --filter @markettrader/frontend dev',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: false,
      timeout: 60_000,
      cwd: '../..',
    },
  ],
});
