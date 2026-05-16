import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { useCommandKStore } from '@/stores/commandKStore';
import type React from 'react';

vi.mock('@/api/stocks', () => ({
  useStockSearch: (query: string) => ({
    data: query
      ? [{ symbol: 'AAPL', name: 'Apple Inc.' }]
      : [],
    isLoading: false,
    error: null,
  }),
}));

vi.mock('@/api/games', () => ({
  useGame: () => ({ data: undefined }),
}));

import { SymbolSearchOverlay } from '@/components/search/SymbolSearchOverlay';

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}</div>;
}

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="*" element={<>{ui}<LocationProbe /></>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('SymbolSearchOverlay', () => {
  beforeEach(() => {
    useCommandKStore.getState().close();
  });

  it('is hidden when the store is closed', () => {
    render(wrap(<SymbolSearchOverlay />));
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('is visible when the store is open', () => {
    useCommandKStore.getState().open$();
    render(wrap(<SymbolSearchOverlay />));
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
  });

  it('closes the store and navigates to /symbols/:symbol on result click', async () => {
    const user = userEvent.setup();
    useCommandKStore.getState().open$();
    render(wrap(<SymbolSearchOverlay />));
    await user.type(screen.getByRole('searchbox'), 'AA');
    const row = await screen.findByText('AAPL');
    await user.click(row);
    expect(useCommandKStore.getState().open).toBe(false);
    expect(screen.getByTestId('location')).toHaveTextContent('/symbols/AAPL');
  });

  it('has an accessible title for screen readers', () => {
    useCommandKStore.getState().open$();
    render(wrap(<SymbolSearchOverlay />));
    expect(screen.getByText('Search symbol')).toBeInTheDocument();
  });

  it('writes to SelectedSymbolContext when inside a game with a provider', async () => {
    const { SelectedSymbolProvider, useSelectedSymbol } = await import(
      '@/contexts/SelectedSymbolContext'
    );
    function SelectedReader() {
      const s = useSelectedSymbol();
      return <div data-testid="selected">{s ?? '(none)'}</div>;
    }
    const user = userEvent.setup();
    useCommandKStore.getState().open$();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/games/g1']}>
          <Routes>
            <Route
              path="/games/:gameId"
              element={
                <SelectedSymbolProvider>
                  <SymbolSearchOverlay />
                  <SelectedReader />
                  <LocationProbe />
                </SelectedSymbolProvider>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await user.type(screen.getByRole('searchbox'), 'AA');
    const row = await screen.findByText('AAPL');
    await user.click(row);
    expect(useCommandKStore.getState().open).toBe(false);
    expect(screen.getByTestId('selected')).toHaveTextContent('AAPL');
    expect(screen.getByTestId('location')).toHaveTextContent('/games/g1');
  });
});
