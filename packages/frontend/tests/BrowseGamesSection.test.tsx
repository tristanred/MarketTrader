import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BrowsableGame } from '@markettrader/shared';

const fetchNextPage = vi.fn();
const state = {
  games: [] as BrowsableGame[],
  total: 0,
  hasNextPage: false,
  isFetchingNextPage: false,
};

vi.mock('@/api/games', () => ({
  useBrowsableGames: () => ({
    ...state,
    isLoading: false,
    isError: false,
    isSuccess: true,
    refetch: vi.fn(),
    fetchNextPage,
  }),
  useJoinGame: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { BrowseGamesSection } from '@/components/game/BrowseGamesSection';

function game(i: number): BrowsableGame {
  return {
    id: `g${i}`,
    name: `Open ${i}`,
    startDate: '2026-11-01T00:00:00Z',
    endDate: '2026-12-01T00:00:00Z',
    startingBalance: 100_000,
    status: 'pending',
    playerCount: 1,
    createdByUsername: 'host',
    createdAt: '2026-10-01T00:00:00Z',
  };
}

describe('BrowseGamesSection pagination', () => {
  beforeEach(() => {
    fetchNextPage.mockReset();
    state.games = [game(1), game(2)];
    state.total = 30;
    state.hasNextPage = true;
    state.isFetchingNextPage = false;
  });

  it('shows the server total, not the loaded count', () => {
    render(<BrowseGamesSection />);
    expect(screen.getByText('30 listed')).toBeInTheDocument();
  });

  it('loads the next page from the Load more button', async () => {
    render(<BrowseGamesSection />);
    await userEvent.click(screen.getByRole('button', { name: /load more/i }));
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('hides Load more when there is no next page', () => {
    state.hasNextPage = false;
    render(<BrowseGamesSection />);
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
  });

  it('disables Load more while a page is in flight', () => {
    state.isFetchingNextPage = true;
    render(<BrowseGamesSection />);
    expect(screen.getByRole('button', { name: /loading/i })).toBeDisabled();
  });
});
