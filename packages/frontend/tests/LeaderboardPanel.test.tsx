import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type React from 'react';
import { LeaderboardPanel } from '@/components/game/arena/LeaderboardPanel';
import { useAuthStore } from '@/stores/authStore';

vi.mock('@/api/leaderboard-history', () => ({
  leaderboardHistoryKeys: { all: ['leaderboard-history'] },
  useLeaderboardHistory: () => ({
    data: {
      range: '5d',
      startedAt: '2026-05-15T00:00:00.000Z',
      endedAt: '2026-05-20T00:00:00.000Z',
      series: [],
    },
    isLoading: false,
    isError: false,
  }),
}));

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>;
}

const ENTRIES = [
  { playerId: 'u1', username: 'marcus', rank: 1, totalValue: 128430.55, cashBalance: 4210 },
  { playerId: 'u2', username: 'tristan', rank: 2, totalValue: 118902.14, cashBalance: 12402 },
  { playerId: 'u3', username: 'jules', rank: 3, totalValue: 96210.0, cashBalance: 8100 },
];

// Generate 30 entries for expand-widget tests; user is at rank 25.
const MANY_ENTRIES = Array.from({ length: 30 }, (_, i) => ({
  playerId: `u${i + 1}`,
  username: `player${i + 1}`,
  rank: i + 1,
  totalValue: 110000 - i * 200,
  cashBalance: 100000,
}));
MANY_ENTRIES[24] = {
  playerId: 'me',
  username: 'tristan',
  rank: 25,
  totalValue: 105000,
  cashBalance: 50000,
};

describe('LeaderboardPanel', () => {
  beforeEach(() => {
    useAuthStore.setState({
      token: 't',
      user: { id: 'u2', username: 'tristan', groups: [] },
    });
  });

  it('renders each entry with rank, value, and P&L%', () => {
    render(
      wrap(<LeaderboardPanel gameId="g1" entries={ENTRIES} startingBalance={100000} />),
    );
    expect(screen.getByText('marcus')).toBeInTheDocument();
    expect(screen.getByText('jules')).toBeInTheDocument();
    expect(screen.getByText('+28.43%')).toBeInTheDocument();
    expect(screen.getByText(/−3\.79%/)).toBeInTheDocument();
  });

  it('pins the current user row to the top, showing them even when their natural rank is high', () => {
    useAuthStore.setState({ token: 't', user: { id: 'me', username: 'tristan', groups: [] } });
    render(
      wrap(<LeaderboardPanel gameId="g1" entries={MANY_ENTRIES} startingBalance={100000} />),
    );
    // The pinned row carries a ▸ marker and #25 — rendered above the column header.
    const pinned = screen.getByText(/▸ tristan/);
    expect(pinned).toBeInTheDocument();
  });

  it('shows the expand widget with a "including you @ #N" hint when the user is hidden', () => {
    useAuthStore.setState({ token: 't', user: { id: 'me', username: 'tristan', groups: [] } });
    render(
      wrap(<LeaderboardPanel gameId="g1" entries={MANY_ENTRIES} startingBalance={100000} />),
    );
    expect(screen.getByText(/show all 30 players/i)).toBeInTheDocument();
    expect(screen.getByText(/including you @ #25/i)).toBeInTheDocument();
  });

  it('toggles expand/collapse on click', () => {
    useAuthStore.setState({ token: 't', user: { id: 'me', username: 'tristan', groups: [] } });
    render(
      wrap(<LeaderboardPanel gameId="g1" entries={MANY_ENTRIES} startingBalance={100000} />),
    );
    const button = screen.getByRole('button', { name: /show all 30 players/i });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    expect(screen.getByRole('button', { name: /collapse to top 10/i })).toBeInTheDocument();
  });

  it('renders a LIVE indicator and a Full view link', () => {
    render(
      wrap(<LeaderboardPanel gameId="g1" entries={ENTRIES} startingBalance={100000} />),
    );
    expect(screen.getByText('LIVE')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /full view/i });
    expect(link.getAttribute('href')).toBe('/games/g1/leaderboard');
  });

  it('renders an empty state when there are no entries', () => {
    render(
      wrap(<LeaderboardPanel gameId="g1" entries={[]} startingBalance={100000} />),
    );
    expect(screen.getByText(/no players/i)).toBeInTheDocument();
  });
});
