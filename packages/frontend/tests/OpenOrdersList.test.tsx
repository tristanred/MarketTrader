import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import type { WorkingOrder, PendingTrade } from '@markettrader/shared';

// Mock the API hooks the component depends on so we control the rendered data.
vi.mock('../src/api/trades', () => ({
  useWorkingOrders: vi.fn(),
  usePendingTrades: vi.fn(),
  useCancelWorkingOrder: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCancelPendingTrade: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { useWorkingOrders, usePendingTrades } from '../src/api/trades';
import { OpenOrdersList } from '../src/components/OpenOrdersList';

function makeWorking(overrides: Partial<WorkingOrder> & { id: string }): WorkingOrder {
  const base: WorkingOrder = {
    id: overrides.id,
    gamePlayerId: 'gp',
    symbol: 'AAPL',
    direction: 'buy',
    quantity: 1,
    orderType: 'limit',
    timeInForce: 'day',
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
  };
  return { ...base, ...overrides };
}

function wrapper(children: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.mocked(useWorkingOrders).mockReset();
  vi.mocked(usePendingTrades).mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('OpenOrdersList', () => {
  it('renders an empty state (null) when no orders', () => {
    vi.mocked(useWorkingOrders).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useWorkingOrders>);
    vi.mocked(usePendingTrades).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof usePendingTrades>);
    const { container } = render(wrapper(<OpenOrdersList gameId="g1" />));
    expect(container.textContent).toBe('');
  });

  it('hides bracket children while the parent is still working', () => {
    const parent = makeWorking({
      id: 'parent',
      orderType: 'bracket',
      bracketRole: 'entry',
      limitPrice: 100,
      takeProfitPrice: 120,
      stopLossPrice: 90,
    });
    const tp = makeWorking({
      id: 'tp-child',
      orderType: 'limit',
      bracketRole: 'take_profit',
      parentTradeId: 'parent',
      direction: 'sell',
      limitPrice: 120,
    });
    const sl = makeWorking({
      id: 'sl-child',
      orderType: 'stop',
      bracketRole: 'stop_loss',
      parentTradeId: 'parent',
      direction: 'sell',
      stopPrice: 90,
      limitPrice: null,
    });
    vi.mocked(useWorkingOrders).mockReturnValue({
      data: [parent, tp, sl],
      isLoading: false,
    } as unknown as ReturnType<typeof useWorkingOrders>);
    vi.mocked(usePendingTrades).mockReturnValue({
      data: [] as PendingTrade[],
      isLoading: false,
    } as unknown as ReturnType<typeof usePendingTrades>);
    render(wrapper(<OpenOrdersList gameId="g1" />));
    // Only one cancel button — for the parent.
    expect(screen.getAllByRole('button', { name: /cancel/i })).toHaveLength(1);
    // Bracket label visible.
    expect(screen.getByText(/Bracket/)).toBeInTheDocument();
  });

  it('surfaces children once the parent is no longer in the working list', () => {
    // Parent already executed — only the two children remain working.
    const tp = makeWorking({
      id: 'tp-child',
      orderType: 'limit',
      bracketRole: 'take_profit',
      parentTradeId: 'parent',
      direction: 'sell',
      limitPrice: 120,
    });
    const sl = makeWorking({
      id: 'sl-child',
      orderType: 'stop',
      bracketRole: 'stop_loss',
      parentTradeId: 'parent',
      direction: 'sell',
      stopPrice: 90,
      limitPrice: null,
    });
    vi.mocked(useWorkingOrders).mockReturnValue({
      data: [tp, sl],
      isLoading: false,
    } as unknown as ReturnType<typeof useWorkingOrders>);
    vi.mocked(usePendingTrades).mockReturnValue({
      data: [] as PendingTrade[],
      isLoading: false,
    } as unknown as ReturnType<typeof usePendingTrades>);
    render(wrapper(<OpenOrdersList gameId="g1" />));
    expect(screen.getAllByRole('button', { name: /cancel/i })).toHaveLength(2);
  });

  it('shows pending rows with a Pending badge', () => {
    vi.mocked(useWorkingOrders).mockReturnValue({
      data: [] as WorkingOrder[],
      isLoading: false,
    } as unknown as ReturnType<typeof useWorkingOrders>);
    const pending: PendingTrade = {
      id: 'p1',
      gamePlayerId: 'gp',
      symbol: 'AAPL',
      direction: 'buy',
      quantity: 5,
      reservedPrice: 100,
      reservedCash: 500,
      placedAt: '2026-05-14T00:00:00Z',
    };
    vi.mocked(usePendingTrades).mockReturnValue({
      data: [pending],
      isLoading: false,
    } as unknown as ReturnType<typeof usePendingTrades>);
    render(wrapper(<OpenOrdersList gameId="g1" />));
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });
});
