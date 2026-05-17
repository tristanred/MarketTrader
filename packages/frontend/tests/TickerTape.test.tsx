import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { TickerTape } from '@/components/shell/TickerTape';
import { INDICES_QUERY_KEY } from '@/hooks/useIndicesSocket';
import { TICKER_TAPE_QUERY_KEY } from '@/api/systemSettings';
import { SelectedSymbolProvider, useSelectedSymbol } from '@/contexts/SelectedSymbolContext';
import type { IndexQuote } from '@markettrader/shared';
import type React from 'react';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(TICKER_TAPE_QUERY_KEY, {
    symbols: ['^GSPC', 'AAPL', 'NVDA'],
    updatedAt: '2026-05-15T14:00:00Z',
  });
  qc.setQueryData<IndexQuote[]>(INDICES_QUERY_KEY, [
    { symbol: '^GSPC', last: 5284.12, changeAbs: 16.83, changePct: 0.32 },
    { symbol: 'AAPL', last: 189.42, changeAbs: 1.57, changePct: 0.84 },
    { symbol: 'NVDA', last: 1178.30, changeAbs: 27.5, changePct: 2.41 },
  ]);
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SelectedSymbolProvider>{ui}</SelectedSymbolProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('TickerTape', () => {
  it('renders each configured symbol with last + percent', () => {
    render(wrap(<TickerTape />));
    const tape = screen.getByTestId('ticker-tape');
    expect(tape.textContent).toContain('^GSPC');
    expect(tape.textContent).toContain('AAPL');
    expect(tape.textContent).toContain('NVDA');
    expect(tape.textContent).toContain('189.42');
    expect(tape.textContent).toContain('+0.32%');
  });

  it('applies the marquee animation class', () => {
    render(wrap(<TickerTape />));
    const marquee = screen.getByTestId('ticker-tape-marquee');
    expect(marquee.className).toMatch(/animate-marquee/);
  });

  it('renders nothing when tape has no symbols yet', () => {
    const qc = new QueryClient();
    const { container } = render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <SelectedSymbolProvider>
            <TickerTape />
          </SelectedSymbolProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(container.textContent).toBe('');
  });

  it('pivots the arena when a symbol is clicked in-game', async () => {
    const user = userEvent.setup();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(TICKER_TAPE_QUERY_KEY, {
      symbols: ['AAPL'],
      updatedAt: '2026-05-15T14:00:00Z',
    });
    qc.setQueryData<IndexQuote[]>(INDICES_QUERY_KEY, [
      { symbol: 'AAPL', last: 189.42, changeAbs: 1.57, changePct: 0.84 },
    ]);
    function SelectedReader() {
      const s = useSelectedSymbol();
      return <div data-testid="selected">{s ?? '(none)'}</div>;
    }
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/games/g1']}>
          <SelectedSymbolProvider>
            <Routes>
              <Route
                path="/games/:gameId"
                element={
                  <>
                    <TickerTape />
                    <SelectedReader />
                  </>
                }
              />
            </Routes>
          </SelectedSymbolProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const items = screen.getAllByText('AAPL');
    await user.click(items[0]!);
    expect(screen.getByTestId('selected')).toHaveTextContent('AAPL');
  });

  it('pivots the arena even for index symbols (^GSPC) when clicked in-game', async () => {
    const user = userEvent.setup();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(TICKER_TAPE_QUERY_KEY, {
      symbols: ['^GSPC'],
      updatedAt: '2026-05-15T14:00:00Z',
    });
    qc.setQueryData<IndexQuote[]>(INDICES_QUERY_KEY, [
      { symbol: '^GSPC', last: 5284.12, changeAbs: 16.83, changePct: 0.32 },
    ]);
    function SelectedReader() {
      const s = useSelectedSymbol();
      return <div data-testid="selected">{s ?? '(none)'}</div>;
    }
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/games/g1']}>
          <SelectedSymbolProvider>
            <Routes>
              <Route
                path="/games/:gameId"
                element={
                  <>
                    <TickerTape />
                    <SelectedReader />
                  </>
                }
              />
            </Routes>
          </SelectedSymbolProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const items = screen.getAllByText('^GSPC');
    await user.click(items[0]!);
    expect(screen.getByTestId('selected')).toHaveTextContent('^GSPC');
  });

  it('links to /symbols/:symbol when clicked outside a game', () => {
    render(wrap(<TickerTape />));
    const link = screen.getAllByRole('link').find((a) =>
      a.getAttribute('href') === '/symbols/AAPL',
    );
    expect(link).toBeDefined();
  });
});
