import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useAuthStore } from '../src/stores/authStore';
import { usePlaceTrade, useWorkingOrders } from '../src/api/trades';
import type { PendingTrade, WorkingOrder } from '@markettrader/shared';

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  };
}

describe('usePlaceTrade — response discrimination', () => {
  beforeEach(() => {
    useAuthStore.setState({ token: 't', user: { id: 'u', username: 'a' }, ready: true });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    useAuthStore.getState().clear();
  });

  it('returns { kind: "executed" } on HTTP 201', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              trade: { id: 't1', symbol: 'AAPL', direction: 'buy', quantity: 1, price: 100 },
              cashBalance: 9900,
            }),
            { status: 201, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );
    const { result } = renderHook(() => usePlaceTrade('g1'), { wrapper: wrapper() });
    const res = await result.current.mutateAsync({
      symbol: 'AAPL',
      direction: 'buy',
      quantity: 1,
    });
    expect(res.kind).toBe('executed');
  });

  it('returns { kind: "pending" } when 202 body has `pending`', async () => {
    const pending: PendingTrade = {
      id: 'p1',
      gamePlayerId: 'gp',
      symbol: 'AAPL',
      direction: 'buy',
      quantity: 1,
      reservedPrice: 100,
      reservedCash: 100,
      placedAt: '2026-05-14T00:00:00Z',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ pending }), {
            status: 202,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    const { result } = renderHook(() => usePlaceTrade('g1'), { wrapper: wrapper() });
    const res = await result.current.mutateAsync({
      symbol: 'AAPL',
      direction: 'buy',
      quantity: 1,
    });
    expect(res.kind).toBe('pending');
    if (res.kind === 'pending') expect(res.pending.id).toBe('p1');
  });

  it('returns { kind: "working" } when 202 body has `orders`', async () => {
    const orders: WorkingOrder[] = [
      {
        id: 'w1',
        gamePlayerId: 'gp',
        symbol: 'AAPL',
        direction: 'buy',
        quantity: 1,
        orderType: 'limit',
        timeInForce: 'gtc',
        limitPrice: 90,
        stopPrice: null,
        stopTriggeredAt: null,
        parentTradeId: null,
        bracketRole: null,
        takeProfitPrice: null,
        stopLossPrice: null,
        expiresAt: null,
        reservedCash: 90,
        placedAt: '2026-05-14T00:00:00Z',
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ orders }), {
            status: 202,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    const { result } = renderHook(() => usePlaceTrade('g1'), { wrapper: wrapper() });
    const res = await result.current.mutateAsync({
      symbol: 'AAPL',
      direction: 'buy',
      quantity: 1,
      orderType: 'limit',
      timeInForce: 'gtc',
      limitPrice: 90,
    });
    expect(res.kind).toBe('working');
    if (res.kind === 'working') {
      expect(res.orders).toHaveLength(1);
      expect(res.orders[0]?.orderType).toBe('limit');
    }
  });
});

describe('useWorkingOrders', () => {
  beforeEach(() => {
    useAuthStore.setState({ token: 't', user: { id: 'u', username: 'a' }, ready: true });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    useAuthStore.getState().clear();
  });

  it('queries GET /games/:id/trades?status=working', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useWorkingOrders('g1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = String(
      (fetchMock.mock.calls as unknown as [string | URL, RequestInit?][])[0]?.[0] ?? '',
    );
    expect(url).toContain('/games/g1/trades?status=working');
  });
});
