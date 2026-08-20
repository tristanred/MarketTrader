import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useIndicesSocket,
  INDICES_QUERY_KEY,
  INDICES_UNAVAILABLE_QUERY_KEY,
} from '@/hooks/useIndicesSocket';
import { TICKER_TAPE_QUERY_KEY } from '@/api/systemSettings';
import { useAuthStore } from '@/stores/authStore';
import { useConnectionStore } from '@/stores/connectionStore';
import type { IndexQuote, WsIndicesEvent, WsTickerTapeConfigChangedEvent } from '@markettrader/shared';
import type React from 'react';

class MockSocket {
  static instances: MockSocket[] = [];
  url: string;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockSocket.instances.push(this);
    setTimeout(() => this.onopen?.(), 0);
  }
  close() {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
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
    useConnectionStore.setState({ game: 'idle', global: 'idle', retryNonce: 0 });
    vi.useFakeTimers();
    // Jitter pinned to its upper bound so delays are exactly the curve.
    vi.spyOn(Math, 'random').mockReturnValue(1);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    globalThis.WebSocket = originalWebSocket;
  });

  /** Advances fake time without draining every pending timer. */
  async function tick(ms = 0) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  /**
   * Closes the newest socket and lets its backoff elapse. 30_001ms clears the
   * longest possible delay while staying under the replacement socket's
   * stability window, so every cycle counts as a failure.
   */
  async function failOneCycle() {
    const socket = MockSocket.instances[MockSocket.instances.length - 1]!;
    await act(async () => socket.close());
    await tick(30_001);
  }

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

  it('grows the reconnect delay across successive open-then-close cycles', async () => {
    const qc = new QueryClient();
    renderHook(() => useIndicesSocket(), { wrapper: wrapper(qc) });
    await tick();
    expect(MockSocket.instances).toHaveLength(1);

    // Cycle 1 — 1s, not the old flat 5s.
    await act(async () => MockSocket.instances[0]!.close());
    await tick(999);
    expect(MockSocket.instances).toHaveLength(1);
    await tick(1);
    expect(MockSocket.instances).toHaveLength(2);

    // Cycle 2 — the delay must double rather than stay flat.
    await tick();
    await act(async () => MockSocket.instances[1]!.close());
    await tick(1_999);
    expect(MockSocket.instances).toHaveLength(2);
    await tick(1);
    expect(MockSocket.instances).toHaveLength(3);
  });

  it('restarts at the base delay once a socket has stayed open long enough', async () => {
    const qc = new QueryClient();
    renderHook(() => useIndicesSocket(), { wrapper: wrapper(qc) });
    await tick();
    await act(async () => MockSocket.instances[0]!.close());
    await tick(1_000);
    expect(MockSocket.instances).toHaveLength(2);

    await tick(31_000);
    await act(async () => MockSocket.instances[1]!.close());
    await tick(999);
    expect(MockSocket.instances).toHaveLength(2);
    await tick(1);
    expect(MockSocket.instances).toHaveLength(3);
  });

  it('gives up after the attempt budget and reports offline', async () => {
    const qc = new QueryClient();
    renderHook(() => useIndicesSocket(), { wrapper: wrapper(qc) });
    await tick();

    for (let i = 0; i < 15; i++) await failOneCycle();

    expect(MockSocket.instances).toHaveLength(11);
    expect(useConnectionStore.getState().global).toBe('offline');
  });

  it('reconnects a given-up socket when the user asks to retry', async () => {
    const qc = new QueryClient();
    renderHook(() => useIndicesSocket(), { wrapper: wrapper(qc) });
    await tick();
    for (let i = 0; i < 15; i++) await failOneCycle();

    await act(async () => {
      useConnectionStore.getState().requestRetry();
    });
    await tick();

    expect(MockSocket.instances).toHaveLength(12);
    expect(useConnectionStore.getState().global).toBe('live');
  });

  it('tracks connection status through open, close and unmount', async () => {
    const qc = new QueryClient();
    const view = renderHook(() => useIndicesSocket(), { wrapper: wrapper(qc) });
    expect(useConnectionStore.getState().global).toBe('connecting');
    await tick();
    expect(useConnectionStore.getState().global).toBe('live');

    await act(async () => MockSocket.instances[0]!.close());
    expect(useConnectionStore.getState().global).toBe('reconnecting');

    view.unmount();
    expect(useConnectionStore.getState().global).toBe('idle');
  });
});
