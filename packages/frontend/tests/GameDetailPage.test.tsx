import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import type React from 'react';

vi.mock('@/api/games', async () => {
  const actual = await vi.importActual<typeof import('@/api/games')>('@/api/games');
  return {
    ...actual,
    useGame: (id: string) => ({
      data: id
        ? {
            id,
            name: 'Friday Night Bloodbath',
            status: 'active',
            startDate: '2026-05-12T00:00:00Z',
            endDate: '2026-05-25T23:59:59Z',
            startingBalance: 100000,
            leaderboard: [
              { playerId: 'u2', username: 'tristan', rank: 1, totalValue: 118902, cashBalance: 12402 },
              { playerId: 'u3', username: 'marcus', rank: 2, totalValue: 95000, cashBalance: 1000 },
            ],
            createdBy: 'u2',
            allowShortSelling: false,
            allowLimitOrders: false,
            allowStopOrders: false,
            allowBracketOrders: false,
            allowGTC: false,
          }
        : undefined,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    }),
  };
});

vi.mock('@/api/trades', () => ({
  usePortfolio: () => ({
    data: {
      cashBalance: 12402,
      totalValue: 118902,
      reservedValue: 0,
      holdings: [
        {
          symbol: 'AAPL',
          quantity: 120,
          avgCostBasis: 175,
          currentPrice: 189.42,
          marketValue: 22730.4,
          unrealizedPnL: 1730.4,
          unrealizedPnLPercent: 8.24,
        },
        {
          symbol: 'NVDA',
          quantity: 40,
          avgCostBasis: 950,
          currentPrice: 1178.3,
          marketValue: 47132,
          unrealizedPnL: 9132,
          unrealizedPnLPercent: 24.03,
        },
      ],
    },
    isLoading: false,
  }),
  useTradeHistory: () => ({ data: [] }),
  useWorkingOrders: () => ({ data: [] }),
  usePendingTrades: () => ({ data: [] }),
  usePlaceTrade: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCancelWorkingOrder: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCancelPendingTrade: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/api/watchlists', () => ({
  useWatchlists: () => ({ data: [{ id: 'w1', name: 'Tech', symbols: ['TSLA', 'MSFT'] }] }),
}));

vi.mock('@/api/stocks', async () => {
  const actual = await vi.importActual<typeof import('@/api/stocks')>('@/api/stocks');
  return {
    ...actual,
    useStockQuote: () => ({ data: undefined, isLoading: false }),
    useStockSearch: () => ({ data: [], isLoading: false, error: null }),
  };
});

vi.mock('@/hooks/useGameSocket', () => ({
  useGameSocket: () => undefined,
}));

vi.mock('@/components/StockChart', () => ({
  StockChart: ({ symbols }: { symbols: string[] }) => (
    <div data-testid="stockchart">chart-{symbols.join(',') || 'none'}</div>
  ),
}));

import { GameDetailPage } from '@/pages/GameDetailPage';

function wrap(initialPath = '/games/g1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/games/:gameId" element={<GameDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('GameDetailPage', () => {
  beforeEach(() => {
    useAuthStore.setState({
      token: 't',
      user: { id: 'u2', username: 'tristan', groups: [] },
    });
  });

  it('renders all nine arena panels', () => {
    render(wrap());
    expect(screen.getByText(/leaderboard/i)).toBeInTheDocument();
    expect(screen.getByText(/your portfolio/i)).toBeInTheDocument();
    // QuoteHeader title "Quote · AAPL"
    expect(screen.getByText(/quote/i)).toBeInTheDocument();
    // getAllByText because the mocked StockChart also emits "chart-AAPL"
    expect(screen.getAllByText(/chart/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/holdings/i)).toBeInTheDocument();
    expect(screen.getByText(/watchlist/i)).toBeInTheDocument();
    // getAllByText because the panel also shows "No activity yet."
    expect(screen.getAllByText(/activity/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
  });

  it('seeds the SelectedSymbolContext with the first holding', () => {
    render(wrap());
    const stockchart = screen.getByTestId('stockchart');
    expect(stockchart).toHaveTextContent('chart-AAPL');
  });

  it('updates the chart when a holding row is clicked', async () => {
    const user = userEvent.setup();
    render(wrap());
    expect(screen.getByTestId('stockchart')).toHaveTextContent('chart-AAPL');
    await user.click(screen.getByText('NVDA'));
    expect(screen.getByTestId('stockchart')).toHaveTextContent('chart-NVDA');
  });

  it('marks the current user row in the leaderboard', () => {
    render(wrap());
    const meRow = screen.getByText('tristan').closest('li');
    expect(meRow?.getAttribute('data-current-user')).toBe('true');
  });
});
