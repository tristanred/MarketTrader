import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { useGameSocket } from '../src/hooks/useGameSocket';
import { useAuthStore } from '../src/stores/authStore';
import { useLiveStore } from '../src/stores/liveStore';

class MockWebSocket {
  static OPEN = 1;
  static instances: MockWebSocket[] = [];
  url: string;
  readyState: number = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((evt: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
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

  receive(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

function Harness({ symbols }: { symbols: string[] }) {
  useGameSocket('game-1', symbols);
  return null;
}

describe('useGameSocket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
    MockWebSocket.instances = [];
    useAuthStore.setState({ token: 'jwt-abc', user: { id: 'u1', username: 'alice' }, ready: true });
    useLiveStore.getState().reset();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    useAuthStore.getState().clear();
  });

  it('connects with the token in the query string and sends an initial subscribe', async () => {
    render(<Harness symbols={['AAPL', 'TSLA']} />);
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(MockWebSocket.instances).toHaveLength(1);
    const ws = MockWebSocket.instances[0]!;
    expect(ws.url).toContain('token=jwt-abc');
    expect(ws.url).toContain('/games/game-1/live');
    expect(ws.sent[0]).toBe(JSON.stringify({ event: 'subscribe', data: { symbols: ['AAPL', 'TSLA'] } }));
  });

  it('dispatches price_update events into the live store', async () => {
    render(<Harness symbols={['AAPL']} />);
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
    render(<Harness symbols={['AAPL']} />);
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
});
