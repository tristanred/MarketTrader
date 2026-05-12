import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    headless: true,
    trace: 'on-first-retry',
  },
  webServer: [
    {
      // Server uses an in-memory SQLite DB and a fixed JWT secret for the e2e run.
      // Invoke tsx directly so we don't trip over the dev script's --env-file flag.
      command: 'pnpm --filter @markettrader/server exec tsx src/index.ts',
      url: 'http://127.0.0.1:3000/health',
      reuseExistingServer: false,
      timeout: 60_000,
      cwd: '../..',
      env: {
        DATABASE_URL: ':memory:',
        JWT_SECRET: 'e2e-test-secret-key-for-playwright-only-not-prod',
        CORS_ORIGIN: 'http://127.0.0.1:5173',
        PORT: '3000',
        NODE_ENV: 'test',
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
