import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GlobalClientRegistry } from '../../src/ws/global-registry.js';
import { IndicesBroadcaster } from '../../src/ws/indices-broadcaster.js';
import type { StockProvider } from '../../src/providers/index.js';
import type { SystemSettingsService } from '../../src/services/system-settings.js';
import { EventEmitter } from 'node:events';

class FakeProvider implements Pick<StockProvider, 'getQuote'> {
  calls: string[] = [];
  failFor = new Set<string>();
  async getQuote(symbol: string) {
    this.calls.push(symbol);
    if (this.failFor.has(symbol)) {
      throw new Error('symbol not supported');
    }
    return {
      symbol,
      price: 100,
      previousClose: 99,
      change: 1,
      changePercent: 1.01,
      currency: 'USD',
      shortName: symbol,
      marketState: 'REGULAR' as const,
      asOf: new Date().toISOString(),
      fetchedAt: new Date().toISOString(),
    };
  }
}

class FakeSettings extends EventEmitter {
  symbols = ['AAPL', '^GSPC'];
  async getTickerTapeSymbols() {
    return { symbols: this.symbols, updatedAt: 'now' };
  }
}

describe('IndicesBroadcaster', () => {
  let registry: GlobalClientRegistry;
  let provider: FakeProvider;
  let settings: FakeSettings;
  let broadcaster: IndicesBroadcaster;

  beforeEach(() => {
    vi.useFakeTimers();
    registry = new GlobalClientRegistry();
    provider = new FakeProvider();
    settings = new FakeSettings();
    broadcaster = new IndicesBroadcaster(
      provider as unknown as StockProvider,
      settings as unknown as SystemSettingsService,
      registry,
      { intervalMs: 5000 },
    );
  });

  afterEach(() => {
    broadcaster.stop();
    vi.useRealTimers();
  });

  it('subscribes to the union of major indices and configured tape symbols', async () => {
    await broadcaster.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(provider.calls.sort()).toEqual(['AAPL', '^DJI', '^GSPC', '^IXIC'].sort());
  });

  it('broadcasts an indices event each tick', async () => {
    const spy = vi.spyOn(registry, 'broadcast');
    await broadcaster.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(spy).toHaveBeenCalledTimes(1);
    const arg = spy.mock.calls[0]![0] as { event: string; data: { quotes: unknown[] } };
    expect(arg.event).toBe('indices');
    expect(arg.data.quotes.length).toBe(4);
  });

  it('re-fetches the tape symbol set when settings emits change', async () => {
    await broadcaster.start();
    settings.symbols = ['MSFT'];
    settings.emit('change', ['MSFT']);
    provider.calls = [];
    await vi.advanceTimersByTimeAsync(5000);
    expect(provider.calls.sort()).toEqual(['MSFT', '^DJI', '^GSPC', '^IXIC'].sort());
  });

  it('emits an unavailable: true payload when all index fetches fail', async () => {
    provider.failFor = new Set(['^GSPC', '^IXIC', '^DJI']);
    const spy = vi.spyOn(registry, 'broadcast');
    await broadcaster.start();
    await vi.advanceTimersByTimeAsync(5000);
    const arg = spy.mock.calls[0]![0] as { data: { unavailable?: boolean } };
    expect(arg.data.unavailable).toBe(true);
  });

  it('stop() halts the tick loop', async () => {
    await broadcaster.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(provider.calls.length).toBeGreaterThan(0);
    broadcaster.stop();
    provider.calls = [];
    await vi.advanceTimersByTimeAsync(15000);
    expect(provider.calls).toEqual([]);
  });
});
