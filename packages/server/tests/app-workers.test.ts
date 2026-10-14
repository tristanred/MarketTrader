import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/workers/pending-orders.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/workers/pending-orders.js')>();
  return { ...actual, startPendingOrdersWorker: vi.fn(() => ({ stop: async () => {} })) };
});

import { buildApp } from '../src/app.js';
import { RuntimeConfig } from '../src/config/runtime-config.js';
import { startPendingOrdersWorker } from '../src/workers/pending-orders.js';
import { createTestDb } from './helpers/app.js';
import { MockStockProvider } from './helpers/mock-provider.js';
import { MockMarketStatusProvider } from './helpers/mock-market-status.js';

describe('buildApp background workers', () => {
  // The same worker fills limit/stop/bracket orders and expires day orders, so
  // gating it on pending mode left resting orders immortal under the default.
  it('starts the pending-orders worker outside pending mode', async () => {
    const cfg = RuntimeConfig.fromEnvironment({ MARKET_HOURS_MODE: 'instant' });
    const app = await buildApp({
      logger: false,
      db: await createTestDb(),
      provider: new MockStockProvider(),
      marketStatusProvider: new MockMarketStatusProvider(),
      runtimeConfig: cfg,
      disablePoller: false,
      disableRateLimit: true,
      loginThrottle: { disabled: true },
    });
    try {
      expect(startPendingOrdersWorker).toHaveBeenCalledTimes(1);
      expect(startPendingOrdersWorker).toHaveBeenCalledWith(expect.objectContaining({ config: cfg }));
    } finally {
      await app.close();
    }
  });
});
