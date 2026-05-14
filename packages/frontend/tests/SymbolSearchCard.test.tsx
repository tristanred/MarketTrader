import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import type { StockQuote, StockSearchResult } from '@markettrader/shared';

vi.mock('../src/api/stocks', () => ({
  useStockSearch: vi.fn(),
  useStockQuote: vi.fn(),
}));

import { useStockSearch, useStockQuote } from '../src/api/stocks';
import { SymbolSearchCard } from '../src/components/SymbolSearchCard';
import { useQuoteDialogStore } from '../src/stores/quoteDialogStore';

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>
  );
}

const quote = (overrides: Partial<StockQuote> & { symbol: string }): StockQuote => ({
  price: 100,
  change: 1.5,
  changePercent: 1.5,
  fetchedAt: '2026-05-14T00:00:00Z',
  ...overrides,
});

const results: StockSearchResult[] = [
  { symbol: 'AAPL', name: 'Apple Inc.' },
  { symbol: 'AAPW', name: 'Roundhill AAPL WeeklyPay ETF' },
];

beforeEach(() => {
  vi.mocked(useStockSearch).mockReset();
  vi.mocked(useStockQuote).mockReset();
  useQuoteDialogStore.setState({
    symbol: null,
    open: false,
    tradeOrderSymbol: null,
    tradeOrderOpen: false,
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('SymbolSearchCard', () => {
  it('does not call search until the debounced query has content', () => {
    vi.mocked(useStockSearch).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useStockSearch>);
    vi.mocked(useStockQuote).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useStockQuote>);

    render(wrap(<SymbolSearchCard />));
    // Initial render with empty query: dropdown not shown.
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(useStockSearch).toHaveBeenCalledWith('');
  });

  it('renders results with price/change and Trade button opens QuoteInfoDialog', async () => {
    vi.mocked(useStockSearch).mockReturnValue({
      data: results,
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useStockSearch>);
    vi.mocked(useStockQuote).mockImplementation(
      (symbol: string) =>
        ({
          data: quote({ symbol, price: 298.21, change: -0.66, changePercent: -0.22 }),
          isLoading: false,
          error: null,
        }) as unknown as ReturnType<typeof useStockQuote>,
    );

    render(wrap(<SymbolSearchCard />));

    const input = screen.getByLabelText(/symbol search/i);
    fireEvent.change(input, { target: { value: 'AAPL' } });
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });
    expect(screen.getByText(/displaying 2 results/i)).toBeInTheDocument();
    expect(screen.getAllByText('298.21').length).toBeGreaterThan(0);

    const tradeButtons = screen.getAllByRole('button', { name: /open aapl trade dialog/i });
    fireEvent.click(tradeButtons[0]!);

    expect(useQuoteDialogStore.getState().open).toBe(true);
    expect(useQuoteDialogStore.getState().symbol).toBe('AAPL');
  });

  it('shows an empty-state message when search returns no rows', async () => {
    vi.mocked(useStockSearch).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useStockSearch>);
    vi.mocked(useStockQuote).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useStockQuote>);

    render(wrap(<SymbolSearchCard />));
    fireEvent.change(screen.getByLabelText(/symbol search/i), {
      target: { value: 'ZZZZ' },
    });
    await waitFor(() => {
      expect(screen.getByText(/no matches/i)).toBeInTheDocument();
    });
  });
});
