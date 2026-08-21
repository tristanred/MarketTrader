import os from 'node:os';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

// A file DB rather than `:memory:`: registration no longer grants any group, so
// the admin fixture has to write the membership itself, and libsql's in-memory
// mode is private to the server process. A fresh path per run keeps each run as
// clean as `:memory:` was. Workers inherit this, so `fixtures/base.ts` finds it.
const E2E_DATABASE_FILE =
  process.env['E2E_DATABASE_FILE'] ??
  path.join(os.tmpdir(), `markettrader-e2e-${Date.now()}-${process.pid}.db`);
process.env['E2E_DATABASE_FILE'] = E2E_DATABASE_FILE;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
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
        DATABASE_URL: E2E_DATABASE_FILE,
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
      env: {
        // Vite reads the workspace-root .env (see `envDir` in vite.config.ts),
        // so without this an e2e run would inherit whatever the developer has
        // configured — emitting browser telemetry into their collector, or
        // retrying POSTs against a dead one. Pin it off so e2e is hermetic.
        VITE_OTEL_EXPORTER_URL: '',
      },
    },
  ],
});
