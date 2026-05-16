import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type React from 'react';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

// Mock the API hook BEFORE importing SymbolSearch so the import-time
// reference picks up the mock.
vi.mock('@/api/stocks', () => ({
  useStockSearch: (query: string) => ({
    data: query
      ? [
          { symbol: 'AAPL', name: 'Apple Inc.' },
          { symbol: 'NVDA', name: 'Nvidia Corp.' },
        ]
      : [],
    isLoading: false,
    error: null,
  }),
}));

// Import after vi.mock so module resolution picks up the mock.
import { SymbolSearch } from '@/components/search/SymbolSearch';

describe('SymbolSearch', () => {
  it('renders an input with the configured placeholder', () => {
    render(wrap(<SymbolSearch onSelect={() => {}} placeholder="▸ Search symbol..." />));
    expect(screen.getByPlaceholderText(/Search symbol/)).toBeInTheDocument();
  });

  it('shows the ⌘K hint when hintKbd is true', () => {
    render(wrap(<SymbolSearch onSelect={() => {}} hintKbd />));
    expect(screen.getByText('⌘K')).toBeInTheDocument();
  });

  it('does not show the ⌘K hint by default', () => {
    render(wrap(<SymbolSearch onSelect={() => {}} />));
    expect(screen.queryByText('⌘K')).toBeNull();
  });

  it('renders results when the query is non-empty', async () => {
    const user = userEvent.setup();
    render(wrap(<SymbolSearch onSelect={() => {}} />));
    await user.type(screen.getByRole('searchbox'), 'AA');
    expect(await screen.findByText('AAPL')).toBeInTheDocument();
    expect(screen.getByText('NVDA')).toBeInTheDocument();
  });

  it('calls onSelect with the chosen symbol when a result is clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(wrap(<SymbolSearch onSelect={onSelect} />));
    await user.type(screen.getByRole('searchbox'), 'AA');
    const row = await screen.findByText('AAPL');
    await user.click(row);
    expect(onSelect).toHaveBeenCalledWith('AAPL');
  });
});
