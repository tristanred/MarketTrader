import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { DiscoverResponse } from '@markettrader/shared';
import { DiscoverPage } from '@/pages/DiscoverPage';
import { useQuoteDialogStore } from '@/stores/quoteDialogStore';
import { ApiError } from '@/lib/api';

let discoverState: {
  data?: DiscoverResponse;
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
} = {};
const refetch = vi.fn();

vi.mock('@/api/discover', () => ({
  useDiscover: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch,
    ...discoverState,
  }),
}));

vi.mock('@/api/games', () => ({
  useGame: (id: string) => ({
    data: { id, name: 'Friday Night Bloodbath', allowShortSelling: false },
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

// The dialogs pull in their own queries; their behavior is covered elsewhere.
vi.mock('@/components/GameTradeDialogs', () => ({ GameTradeDialogs: () => null }));

const READY: DiscoverResponse = {
  status: 'ready',
  list: {
    gameId: 'g1',
    sessionDate: '2026-05-18',
    generatedAt: '2026-05-18T20:05:00.000Z',
    sections: [
      {
        kind: 'picks',
        items: [
          { symbol: 'XOM', name: 'Exxon Mobil', price: 110, changePct: -1.2, sector: 'Energy' },
          {
            symbol: 'NVDA',
            name: 'Nvidia',
            price: 950,
            changePct: 3.4,
            sector: 'Information Technology',
          },
          {
            symbol: 'ADBE',
            name: 'Adobe',
            price: null,
            changePct: null,
            sector: 'Information Technology',
          },
        ],
      },
      {
        kind: 'gainers',
        items: [{ symbol: 'SMCI', name: 'Super Micro', price: 40, changePct: 12.5 }],
      },
    ],
  },
};

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/games/g1/discover']}>
        <Routes>
          <Route path="/games/:gameId/discover" element={<DiscoverPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  discoverState = {};
  refetch.mockReset();
  useQuoteDialogStore.setState({ open: false, symbol: null });
});

describe('DiscoverPage', () => {
  it('shows the picks as a grid sorted by move, unquoted last, with the quote time', () => {
    discoverState = { data: READY };
    renderPage();

    expect(screen.getByRole('heading', { name: 'Discover' })).toBeInTheDocument();
    const tiles = screen.getAllByRole('button', { name: /Open quote\.$/ });
    expect(tiles.map((t) => t.getAttribute('aria-label')?.split(',')[0])).toEqual([
      'NVDA',
      'XOM',
      'ADBE',
    ]);
    expect(screen.getByText(/Prices as of/)).toHaveTextContent(/Mon/);
    expect(screen.getByText('Mon, May 18')).toBeInTheDocument();
  });

  it('opens the quote dialog for a tile', async () => {
    discoverState = { data: READY };
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^NVDA, Nvidia, up 3\.40%/ }));
    expect(useQuoteDialogStore.getState()).toMatchObject({ open: true, symbol: 'NVDA' });
  });

  it('filters the grid by sector', async () => {
    discoverState = { data: READY };
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^Energy/ }));
    expect(screen.getByRole('button', { name: /^Energy/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: /^NVDA/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^XOM/ })).toBeInTheDocument();
  });

  it('lists the market movers that were captured', () => {
    discoverState = { data: READY };
    renderPage();
    const gainers = screen.getByRole('list', { name: 'Top gainers' });
    expect(within(gainers).getByText('SMCI')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Top losers' })).toBeNull();
  });

  it('explains when movers are missing for the session', () => {
    discoverState = {
      data: {
        status: 'ready',
        list: {
          ...(READY as Extract<DiscoverResponse, { status: 'ready' }>).list,
          sections: [READY.list.sections[0]!],
        },
      },
    };
    renderPage();
    expect(screen.getByText(/weren’t captured for this session/)).toBeInTheDocument();
  });

  it('tells the player the draw is on its way while preparing', () => {
    discoverState = { data: { status: 'preparing' } };
    renderPage();
    expect(screen.getByText(/being prepared/)).toBeInTheDocument();
  });

  it('points to the final standings once the game has ended', () => {
    discoverState = { data: { status: 'ended' } };
    renderPage();
    expect(screen.getByRole('link', { name: /final standings/i })).toHaveAttribute(
      'href',
      '/games/g1/leaderboard',
    );
  });

  it('offers a retry on a load error', async () => {
    discoverState = { isError: true, error: new Error('network') };
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it('shows not-found for a game the player is not in', () => {
    discoverState = { isError: true, error: new ApiError(404, {}, 'Game not found') };
    renderPage();
    expect(screen.getByRole('heading', { name: /game not found/i })).toBeInTheDocument();
  });
});
