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
          { symbol: 'AAPL', name: 'Apple Inc.', changePercent: 1.23 },
          { symbol: 'NVDA', name: 'Nvidia Corp.', changePercent: -0.5 },
          { symbol: 'TSLA', name: 'Tesla Inc.' },
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

  it('selects the first result when Enter is pressed without arrow keys', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(wrap(<SymbolSearch onSelect={onSelect} />));
    const input = screen.getByRole('searchbox');
    await user.type(input, 'msft');
    await screen.findByText('AAPL');
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('AAPL');
  });

  it('moves the active row with ArrowDown and selects with Enter', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(wrap(<SymbolSearch onSelect={onSelect} />));
    const input = screen.getByRole('searchbox');
    await user.type(input, 'a');
    await screen.findByText('AAPL');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenCalledWith('NVDA');
  });

  it('wraps the active row with ArrowUp from the first row', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(wrap(<SymbolSearch onSelect={onSelect} />));
    const input = screen.getByRole('searchbox');
    await user.type(input, 'a');
    await screen.findByText('AAPL');
    await user.keyboard('{ArrowUp}{Enter}');
    expect(onSelect).toHaveBeenCalledWith('TSLA'); // wraps to the last row
  });

  it('shows each result\'s day change%, color-coded, with "—" when absent', async () => {
    const user = userEvent.setup();
    render(wrap(<SymbolSearch onSelect={() => {}} />));
    await user.type(screen.getByRole('searchbox'), 'a');
    await screen.findByText('AAPL');

    const gain = screen.getByText('+1.23%');
    expect(gain).toBeInTheDocument();
    expect(gain).toHaveClass('text-gain');

    const loss = screen.getByText('-0.50%');
    expect(loss).toBeInTheDocument();
    expect(loss).toHaveClass('text-loss');

    // TSLA has no changePercent → renders an em dash.
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
