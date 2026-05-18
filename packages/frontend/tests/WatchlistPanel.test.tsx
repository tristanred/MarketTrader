import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type React from 'react';
import { WatchlistPanel, type WatchlistRow } from '@/components/game/arena/WatchlistPanel';

vi.mock('@/api/stocks', () => ({
  useStockSearch: (query: string) => ({
    data: query
      ? [{ symbol: 'MSFT', name: 'Microsoft Corporation' }]
      : [],
    isLoading: false,
    error: null,
  }),
}));

const ROWS: WatchlistRow[] = [
  { symbol: 'AAPL', last: 189.42, changePct: 0.84 },
  { symbol: 'NVDA', last: 1178.3, changePct: 2.41 },
  { symbol: 'TSLA', last: 241.05, changePct: -1.12 },
];

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe('WatchlistPanel', () => {
  it('renders each row with symbol, last, and change %', () => {
    render(wrap(<WatchlistPanel rows={ROWS} />));
    expect(screen.getByText('AAPL')).toBeInTheDocument();
    expect(screen.getByText('189.42')).toBeInTheDocument();
    expect(screen.getByText('+0.84%')).toBeInTheDocument();
    expect(screen.getByText('−1.12%')).toBeInTheDocument();
  });

  it('calls onSelect with the chosen symbol on row click', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(wrap(<WatchlistPanel rows={ROWS} onSelect={onSelect} />));
    await user.click(screen.getByText('TSLA'));
    expect(onSelect).toHaveBeenCalledWith('TSLA');
  });

  it('renders an empty state when no rows', () => {
    render(wrap(<WatchlistPanel rows={[]} />));
    expect(screen.getByText(/empty/i)).toBeInTheDocument();
  });

  it('expands an inline search when + ADD is clicked', async () => {
    const user = userEvent.setup();
    render(wrap(<WatchlistPanel rows={ROWS} watchlistId="wl-1" />));
    const addBtn = screen.getByRole('button', { name: /\+ ?ADD/i });
    await user.click(addBtn);
    // Header label flips to "Add to watchlist" with an ESC chip.
    expect(screen.getByText(/add to watchlist/i)).toBeInTheDocument();
    expect(screen.getByText('ESC')).toBeInTheDocument();
    // Inline search input is focused.
    expect(screen.getByPlaceholderText(/search symbol to add/i)).toBeInTheDocument();
  });
});
