import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useIndicesSocket,
  INDICES_QUERY_KEY,
  INDICES_UNAVAILABLE_QUERY_KEY,
} from '@/hooks/useIndicesSocket';
import { TICKER_TAPE_QUERY_KEY } from '@/api/systemSettings';
import { useAuthStore } from '@/stores/authStore';
import type { IndexQuote, WsIndicesEvent, WsTickerTapeConfigChangedEvent } from '@markettrader/shared';
import type React from 'react';

class MockSocket {
  static instances: MockSocket[] = [];
  url: string;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockSocket.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  emit(msg: object) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

function wrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('useIndicesSocket', () => {
  let originalWebSocket: typeof WebSocket;

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
    // @ts-expect-error — minimal mock satisfying the surface the hook uses
    globalThis.WebSocket = MockSocket;
    MockSocket.instances = [];
    useAuthStore.setState({ token: 'tok', user: { id: 'u', username: 'u', groups: [] } });
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
  });

  it('writes quotes into INDICES_QUERY_KEY and unavailable=false on a healthy indices message', () => {
    const qc = new QueryClient();
    renderHook(() => useIndicesSocket(), { wrapper: wrapper(qc) });
    const socket = MockSocket.instances[0]!;
    const event: WsIndicesEvent = {
      event: 'indices',
      data: {
        quotes: [{ symbol: '^GSPC', last: 5000, changeAbs: 1, changePct: 0.02 }],
        at: '2026-05-15T14:00:00Z',
      },
    };
    socket.emit(event);
    expect(qc.getQueryData<IndexQuote[]>(INDICES_QUERY_KEY)).toEqual(event.data.quotes);
    expect(qc.getQueryData<boolean>(INDICES_UNAVAILABLE_QUERY_KEY)).toBe(false);
  });

  it('writes unavailable=true when the indices message carries the flag', () => {
    const qc = new QueryClient();
    renderHook(() => useIndicesSocket(), { wrapper: wrapper(qc) });
    const socket = MockSocket.instances[0]!;
    const event: WsIndicesEvent = {
      event: 'indices',
      data: { quotes: [], at: '2026-05-15T14:00:00Z', unavailable: true },
    };
    socket.emit(event);
    expect(qc.getQueryData<boolean>(INDICES_UNAVAILABLE_QUERY_KEY)).toBe(true);
  });

  it('invalidates the ticker-tape query on a config-changed message', () => {
    const qc = new QueryClient();
    qc.setQueryData(TICKER_TAPE_QUERY_KEY, { symbols: ['OLD'], updatedAt: 'old' });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useIndicesSocket(), { wrapper: wrapper(qc) });
    const socket = MockSocket.instances[0]!;
    const event: WsTickerTapeConfigChangedEvent = {
      event: 'ticker_tape_config_changed',
      data: { symbols: ['NEW'], at: '2026-05-15T14:00:00Z' },
    };
    socket.emit(event);
    expect(spy).toHaveBeenCalledWith({ queryKey: TICKER_TAPE_QUERY_KEY });
  });

  it('does not open a socket when there is no auth token', () => {
    useAuthStore.setState({ token: null, user: null });
    const qc = new QueryClient();
    renderHook(() => useIndicesSocket(), { wrapper: wrapper(qc) });
    expect(MockSocket.instances).toHaveLength(0);
  });

  it('swallows malformed messages without throwing', () => {
    const qc = new QueryClient();
    renderHook(() => useIndicesSocket(), { wrapper: wrapper(qc) });
    const socket = MockSocket.instances[0]!;
    expect(() => socket.onmessage?.({ data: 'not-json' })).not.toThrow();
    expect(qc.getQueryData<IndexQuote[]>(INDICES_QUERY_KEY)).toBeUndefined();
  });
});
