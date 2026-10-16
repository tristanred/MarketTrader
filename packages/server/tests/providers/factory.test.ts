import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RuntimeConfig } from '../../src/config/runtime-config.js';

describe('createProvider', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a MockProvider when STOCK_PROVIDER=mock', async () => {
    vi.stubEnv('STOCK_PROVIDER', 'mock');
    vi.stubEnv('DATABASE_URL', ':memory:');
    vi.stubEnv('JWT_SECRET', 'x'.repeat(32));
    const mod = await import('../../src/providers/factory.js');
    const provider = mod.createProvider(RuntimeConfig.fromEnvironment());
    expect(provider.constructor.name).toBe('MockProvider');
  });
});
