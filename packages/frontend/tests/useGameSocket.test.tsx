import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useGameSocket } from '../src/hooks/useGameSocket';
import { useAuthStore } from '../src/stores/authStore';
import { useLiveStore } from '../src/stores/liveStore';
import { useConnectionStore } from '../src/stores/connectionStore';
import { WS_AUTH_SUBPROTOCOL } from '../src/lib/wsAuth';
import { tryRefresh } from '../src/lib/api';

vi.mock('../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/api')>();
  return { ...actual, tryRefresh: vi.fn(async () => true) };
});

function withQueryClient(children: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

class MockWebSocket {
  static OPEN = 1;
  static instances: MockWebSocket[] = [];
  url: string;
  protocols: string[];
  readyState: number = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((evt: { data: string }) => void) | null = null;
  onclose: ((evt?: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = protocols === undefined ? [] : [protocols].flat();
    MockWebSocket.instances.push(this);
    setTimeout(() => this.onopen?.(), 0);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  /** Server-initiated close carrying a status code. */
  closeWith(code: number): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }

  receive(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

function Harness({ symbols }: { symbols: string[] }) {
  useGameSocket('game-1', symbols, null);
  return null;
}

describe('useGameSocket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
    MockWebSocket.instances = [];
    vi.mocked(tryRefresh).mockClear();
    useAuthStore.setState({ token: 'jwt-abc', user: { id: 'u1', username: 'alice', groups: [] }, ready: true });
    useLiveStore.getState().reset();
    useConnectionStore.setState({ game: 'idle', global: 'idle', retryNonce: 0 });
    // Jitter pinned to its upper bound so delays are exactly the curve.
    vi.spyOn(Math, 'random').mockReturnValue(1);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    useAuthStore.getState().clear();
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
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    await act(async () => ws.close());
    await tick(30_001);
  }

  it('pins the auth subprotocol wire value', () => {
    // Duplicated in packages/server/src/ws/subprotocol.ts — `shared` carries
    // types only, so nothing else makes a one-sided rename fail.
    expect(WS_AUTH_SUBPROTOCOL).toBe('markettrader.auth.v1');
  });

  it('offers the token as a subprotocol, keeps it out of the URL, and sends an initial subscribe', async () => {
    render(withQueryClient(<Harness symbols={['AAPL', 'TSLA']} />));
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(MockWebSocket.instances).toHaveLength(1);
    const ws = MockWebSocket.instances[0]!;
    expect(ws.url).toContain('/games/game-1/live');
    // The URL is written verbatim to proxy and process logs, so the credential
    // must never appear in it — see the server's F6/F22 regression test.
    expect(ws.url).not.toContain('jwt-abc');
    expect(ws.url).not.toContain('token=');
    expect(ws.protocols).toEqual([WS_AUTH_SUBPROTOCOL, 'jwt-abc']);
    expect(ws.sent[0]).toBe(JSON.stringify({ event: 'subscribe', data: { symbols: ['AAPL', 'TSLA'] } }));
  });

  it('refreshes the credential when an established socket is closed as unauthorized', async () => {
    render(withQueryClient(<Harness symbols={['AAPL']} />));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    const ws = MockWebSocket.instances[0]!;

    // The server revalidates admitted sockets and closes them with 1008 when the
    // access token expires. Reconnecting with the same token just repeats it.
    await tick(10_000);
    await act(async () => ws.closeWith(1008));

    expect(vi.mocked(tryRefresh)).toHaveBeenCalledTimes(1);
    // No blind reconnect: the new token re-runs the effect instead.
    await tick(60_000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('backs off instead of refreshing when 1008 lands right after open', async () => {
    render(withQueryClient(<Harness symbols={['AAPL']} />));
    // Only far enough to fire the open callback — `runAllTimersAsync` would
    // also drain the 30s stability timer and move the clock with it.
    await tick(0);
    const ws = MockWebSocket.instances[0]!;

    // An immediate 1008 is an authorization refusal — removed from the game, or
    // a disabled account. A fresh token would not help, and refreshing on it
    // would spin.
    await act(async () => ws.closeWith(1008));
    expect(vi.mocked(tryRefresh)).not.toHaveBeenCalled();
    await tick(30_001);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('dispatches price_update events into the live store', async () => {
    render(withQueryClient(<Harness symbols={['AAPL']} />));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    const ws = MockWebSocket.instances[0]!;

    act(() => {
      ws.receive({
        event: 'price_update',
        data: [{ symbol: 'AAPL', price: 200, change: 0, changePercent: 0, fetchedAt: '2026-05-12T00:00:00Z' }],
      });
    });

    expect(useLiveStore.getState().pricesBySymbol['AAPL']?.price).toBe(200);
  });

  it('dispatches leaderboard_update and trade_executed events', async () => {
    render(withQueryClient(<Harness symbols={['AAPL']} />));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    const ws = MockWebSocket.instances[0]!;

    act(() => {
      ws.receive({
        event: 'leaderboard_update',
        data: [{ playerId: 'u1', username: 'alice', totalValue: 1000, rank: 1 }],
      });
      ws.receive({
        event: 'trade_executed',
        data: {
          playerId: 'u1',
          symbol: 'AAPL',
          direction: 'buy',
          quantity: 1,
          price: 200,
          executedAt: '2026-05-12T00:00:00Z',
        },
      });
    });

    expect(useLiveStore.getState().leaderboard?.[0]?.rank).toBe(1);
    expect(useLiveStore.getState().recentTrades[0]?.symbol).toBe('AAPL');
  });

  it('grows the reconnect delay across successive open-then-close cycles', async () => {
    render(withQueryClient(<Harness symbols={['AAPL']} />));
    await tick();
    expect(MockWebSocket.instances).toHaveLength(1);

    // Cycle 1 — handshake succeeds, socket dies straight away. 1s.
    await act(async () => MockWebSocket.instances[0]!.close());
    await tick(999);
    expect(MockWebSocket.instances).toHaveLength(1);
    await tick(1);
    expect(MockWebSocket.instances).toHaveLength(2);

    // Cycle 2 — same again. The delay must double, not restart at 1s.
    await tick();
    await act(async () => MockWebSocket.instances[1]!.close());
    await tick(1_999);
    expect(MockWebSocket.instances).toHaveLength(2);
    await tick(1);
    expect(MockWebSocket.instances).toHaveLength(3);

    // Cycle 3 — 4s.
    await tick();
    await act(async () => MockWebSocket.instances[2]!.close());
    await tick(3_999);
    expect(MockWebSocket.instances).toHaveLength(3);
    await tick(1);
    expect(MockWebSocket.instances).toHaveLength(4);
  });

  it('restarts at the base delay once a socket has stayed open long enough', async () => {
    render(withQueryClient(<Harness symbols={['AAPL']} />));
    await tick();
    await act(async () => MockWebSocket.instances[0]!.close());
    await tick(1_000);
    expect(MockWebSocket.instances).toHaveLength(2);

    // This one survives the stability window, so the counter clears.
    await tick(31_000);
    await act(async () => MockWebSocket.instances[1]!.close());
    await tick(999);
    expect(MockWebSocket.instances).toHaveLength(2);
    await tick(1);
    expect(MockWebSocket.instances).toHaveLength(3);
  });

  it('gives up after the attempt budget and reports offline', async () => {
    render(withQueryClient(<Harness symbols={['AAPL']} />));
    await tick();

    for (let i = 0; i < 15; i++) await failOneCycle();

    // 1 initial + 10 retries, then it stops instead of looping forever.
    expect(MockWebSocket.instances).toHaveLength(11);
    expect(useConnectionStore.getState().game).toBe('offline');
  });

  it('reconnects a given-up socket when the user asks to retry', async () => {
    render(withQueryClient(<Harness symbols={['AAPL']} />));
    await tick();
    for (let i = 0; i < 15; i++) await failOneCycle();
    expect(MockWebSocket.instances).toHaveLength(11);

    await act(async () => {
      useConnectionStore.getState().requestRetry();
    });
    await tick();

    expect(MockWebSocket.instances).toHaveLength(12);
    expect(useConnectionStore.getState().game).toBe('live');
  });

  it('tracks connection status through open, close and unmount', async () => {
    const view = render(withQueryClient(<Harness symbols={['AAPL']} />));
    expect(useConnectionStore.getState().game).toBe('connecting');
    await tick();
    expect(useConnectionStore.getState().game).toBe('live');

    await act(async () => MockWebSocket.instances[0]!.close());
    expect(useConnectionStore.getState().game).toBe('reconnecting');

    view.unmount();
    expect(useConnectionStore.getState().game).toBe('idle');
  });
});
