import { describe, it, expect, beforeEach, vi } from 'vitest';

async function loadStore() {
  vi.resetModules();
  return (await import('@/stores/chartPrefsStore')).useChartPrefsStore;
}

describe('chartPrefsStore', () => {
  beforeEach(() => window.localStorage.clear());

  it('defaults to candles with volume and trades shown', async () => {
    const s = (await loadStore()).getState();
    expect(s).toMatchObject({ type: 'candles', showVolume: true, showTrades: true });
  });

  it('persists changes and restores them on the next load', async () => {
    const store = await loadStore();
    store.getState().setType('area');
    store.getState().toggleVolume();
    const restored = (await loadStore()).getState();
    expect(restored).toMatchObject({ type: 'area', showVolume: false, showTrades: true });
  });

  it('ignores a corrupt or foreign stored value', async () => {
    window.localStorage.setItem('mt:chart', '{"type":"bogus","showVolume":"yes"}');
    expect((await loadStore()).getState()).toMatchObject({ type: 'candles', showVolume: true });
    window.localStorage.setItem('mt:chart', 'not json');
    expect((await loadStore()).getState().type).toBe('candles');
  });
});
