import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { StatusStrip } from '@/components/shell/StatusStrip';
import { INDICES_QUERY_KEY, INDICES_UNAVAILABLE_QUERY_KEY } from '@/hooks/useIndicesSocket';
import { SelectedSymbolProvider } from '@/contexts/SelectedSymbolContext';
import type { IndexQuote } from '@markettrader/shared';
import type React from 'react';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    qc,
    ui: (
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <SelectedSymbolProvider>{ui}</SelectedSymbolProvider>
        </MemoryRouter>
      </QueryClientProvider>
    ),
  };
}

describe('StatusStrip', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-15T14:23:08-04:00'));
  });
  afterEach(() => vi.useRealTimers());

  it('renders MARKET OPEN/CLOSED indicator, ticking ET clock, and a LIVE pill', () => {
    const { ui } = wrap(<StatusStrip />);
    render(ui);
    expect(screen.getByText(/MARKET (OPEN|CLOSED)/)).toBeInTheDocument();
    expect(screen.getByText(/\d{2}:\d{2}:\d{2}/)).toBeInTheDocument();
    expect(screen.getByText('LIVE')).toBeInTheDocument();
  });

  it('renders index quotes from the React Query cache', () => {
    const { qc, ui } = wrap(<StatusStrip />);
    qc.setQueryData<IndexQuote[]>(INDICES_QUERY_KEY, [
      { symbol: '^GSPC', last: 5284.12, changeAbs: 16.83, changePct: 0.32 },
      { symbol: '^IXIC', last: 16742.39, changeAbs: 84.7, changePct: 0.51 },
      { symbol: '^DJI', last: 39118.86, changeAbs: -31.5, changePct: -0.08 },
    ]);
    render(ui);
    expect(screen.getByText('^GSPC')).toBeInTheDocument();
    expect(screen.getByText('5,284.12')).toBeInTheDocument();
    expect(screen.getByText('+0.32%')).toBeInTheDocument();
    expect(screen.getByText('−0.08%')).toBeInTheDocument(); // unicode minus
  });

  it('renders INDICES UNAVAILABLE when the cache holds an unavailable payload', () => {
    const { qc, ui } = wrap(<StatusStrip />);
    qc.setQueryData(INDICES_QUERY_KEY, []);
    qc.setQueryData(INDICES_UNAVAILABLE_QUERY_KEY, true);
    render(ui);
    expect(screen.getByText(/INDICES UNAVAILABLE/i)).toBeInTheDocument();
  });

  it('shows DAY n / N + game name when given gameContext', () => {
    const { ui } = wrap(
      <StatusStrip gameContext={{ name: 'Friday Night', dayCurrent: 4, dayTotal: 14, gameId: 'g1' }} />,
    );
    render(ui);
    expect(screen.getByText(/DAY 4 \/ 14/)).toBeInTheDocument();
    expect(screen.getByText(/Friday Night/)).toBeInTheDocument();
  });
});
