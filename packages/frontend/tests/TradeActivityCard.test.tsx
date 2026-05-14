import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

vi.mock('../src/components/TradeHistoryTable', () => ({
  TradeHistoryTable: ({ gameId }: { gameId: string }) => (
    <div data-testid="history">history:{gameId}</div>
  ),
}));
vi.mock('../src/components/OpenOrdersList', () => ({
  OpenOrdersList: ({ gameId }: { gameId: string }) => (
    <div data-testid="open-orders">open-orders:{gameId}</div>
  ),
}));

import { TradeActivityCard } from '../src/components/TradeActivityCard';

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {});
afterEach(() => vi.restoreAllMocks());

describe('TradeActivityCard', () => {
  it('renders the History tab by default', () => {
    render(wrap(<TradeActivityCard gameId="g1" />));
    const historyTab = screen.getByRole('tab', { name: /history/i });
    expect(historyTab).toHaveAttribute('data-state', 'active');
    expect(screen.getByTestId('history')).toHaveTextContent('history:g1');
  });

  it('switches to Open Orders when its tab is clicked', async () => {
    const user = userEvent.setup();
    render(wrap(<TradeActivityCard gameId="g1" />));
    const openOrdersTab = screen.getByRole('tab', { name: /open orders/i });
    await user.click(openOrdersTab);
    expect(openOrdersTab).toHaveAttribute('data-state', 'active');
    expect(screen.getByRole('tab', { name: /history/i })).toHaveAttribute(
      'data-state',
      'inactive',
    );
  });

  it('does not show the legacy Trade or Chart tabs', () => {
    render(wrap(<TradeActivityCard gameId="g1" />));
    expect(screen.queryByRole('tab', { name: /^trade$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /chart/i })).not.toBeInTheDocument();
  });
});
