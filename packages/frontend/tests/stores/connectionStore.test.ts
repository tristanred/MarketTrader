import { beforeEach, describe, expect, it } from 'vitest';
import { useConnectionStore, selectConnectionStatus } from '@/stores/connectionStore';

describe('connectionStore', () => {
  beforeEach(() => {
    useConnectionStore.setState({ game: 'idle', global: 'idle', retryNonce: 0 });
  });

  it('starts with both channels idle', () => {
    expect(selectConnectionStatus(useConnectionStore.getState())).toBe('idle');
  });

  it('reports the worst status across both channels', () => {
    useConnectionStore.getState().setStatus('global', 'live');
    useConnectionStore.getState().setStatus('game', 'offline');
    expect(selectConnectionStatus(useConnectionStore.getState())).toBe('offline');
  });

  it('ranks reconnecting above connecting and live', () => {
    useConnectionStore.getState().setStatus('global', 'connecting');
    useConnectionStore.getState().setStatus('game', 'reconnecting');
    expect(selectConnectionStatus(useConnectionStore.getState())).toBe('reconnecting');
  });

  it('ignores channels with no socket mounted', () => {
    useConnectionStore.getState().setStatus('global', 'live');
    expect(useConnectionStore.getState().game).toBe('idle');
    expect(selectConnectionStatus(useConnectionStore.getState())).toBe('live');
  });

  it('bumps retryNonce so mounted sockets can observe a manual retry', () => {
    useConnectionStore.getState().requestRetry();
    useConnectionStore.getState().requestRetry();
    expect(useConnectionStore.getState().retryNonce).toBe(2);
  });
});
