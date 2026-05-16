import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type React from 'react';

vi.mock('@/components/StockChart', () => ({
  StockChart: ({ symbols }: { symbols: string[] }) => (
    <div data-testid="stockchart">{symbols.join(',') || '(none)'}</div>
  ),
}));

import { ChartPanel } from '@/components/game/arena/ChartPanel';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>;
}

describe('ChartPanel', () => {
  it('renders the StockChart with the given symbol when present', () => {
    render(wrap(<ChartPanel symbol="AAPL" />));
    expect(screen.getByTestId('stockchart')).toHaveTextContent('AAPL');
  });

  it('renders an empty-state when symbol is null', () => {
    render(wrap(<ChartPanel symbol={null} />));
    expect(screen.queryByTestId('stockchart')).toBeNull();
    expect(screen.getByText(/select a symbol/i)).toBeInTheDocument();
  });

  it('renders a panel header "Chart"', () => {
    render(wrap(<ChartPanel symbol="AAPL" />));
    expect(screen.getByText(/chart/i)).toBeInTheDocument();
  });
});
