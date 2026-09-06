import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type React from 'react';

const gamesData: Array<{
  id: string;
  name: string;
  status: 'pending' | 'active' | 'ended';
  startingBalance: number;
  startDate: string;
  endDate: string;
}> = [];

const browsableData: Array<{
  id: string;
  name: string;
  status: 'pending' | 'active' | 'ended';
  startingBalance: number;
  startDate: string;
  endDate: string;
  playerCount: number;
  createdByUsername: string;
  createdAt: string;
}> = [];

vi.mock('@/api/games', () => ({
  useGames: () => ({ data: gamesData, isLoading: false, isError: false }),
  useBrowsableGames: () => ({
    data: browsableData,
    isLoading: false,
    isError: false,
    isSuccess: true,
    refetch: vi.fn(),
  }),
  useJoinGame: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/components/CreateGameDialog', () => ({
  CreateGameDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog">Set up a virtual trading tournament.</div> : null,
}));

import { GamesListPage } from '@/pages/GamesListPage';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('GamesListPage', () => {
  it('keeps the new-game action out of sight until the menu is opened', () => {
    gamesData.length = 0;
    render(wrap(<GamesListPage />));
    expect(screen.getByText('Your games')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /games menu/i })).toBeInTheDocument();
    expect(screen.queryByText(/new game/i)).not.toBeInTheDocument();
  });

  it('reveals the new-game action once the menu is opened', async () => {
    gamesData.length = 0;
    const user = userEvent.setup();
    render(wrap(<GamesListPage />));
    await user.click(screen.getByRole('button', { name: /games menu/i }));
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /new game/i })).toBeInTheDocument();
  });

  it('lands keyboard focus on the first item when the menu opens', async () => {
    gamesData.length = 0;
    const user = userEvent.setup();
    render(wrap(<GamesListPage />));
    await user.click(screen.getByRole('button', { name: /games menu/i }));
    expect(await screen.findByRole('menuitem', { name: /new game/i })).toHaveFocus();
  });

  it('returns focus to the trigger when the menu is dismissed', async () => {
    gamesData.length = 0;
    const user = userEvent.setup();
    render(wrap(<GamesListPage />));
    const trigger = screen.getByRole('button', { name: /games menu/i });
    await user.click(trigger);
    await screen.findByRole('menu');
    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
  });

  it('opens the create-game dialog from the menu', async () => {
    gamesData.length = 0;
    const user = userEvent.setup();
    render(wrap(<GamesListPage />));
    await user.click(screen.getByRole('button', { name: /games menu/i }));
    await user.click(await screen.findByRole('menuitem', { name: /new game/i }));
    expect(await screen.findByText(/set up a virtual trading tournament/i)).toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('points a viewer with no games at the menu rather than a button', () => {
    gamesData.length = 0;
    render(wrap(<GamesListPage />));
    expect(screen.getByText(/no games yet/i)).toBeInTheDocument();
    expect(screen.getByText(/menu to create one/i)).toBeInTheDocument();
  });

  it('renders one row-card per game with name + status', () => {
    gamesData.length = 0;
    gamesData.push(
      {
        id: 'g1',
        name: 'Friday Night Bloodbath',
        status: 'active',
        startingBalance: 100000,
        startDate: '2026-05-12T00:00:00Z',
        endDate: '2026-05-25T23:59:59Z',
      },
      {
        id: 'g2',
        name: 'May Weekly Cup',
        status: 'ended',
        startingBalance: 50000,
        startDate: '2026-04-01T00:00:00Z',
        endDate: '2026-04-30T00:00:00Z',
      },
    );
    render(wrap(<GamesListPage />));
    expect(screen.getByText('Friday Night Bloodbath')).toBeInTheDocument();
    expect(screen.getByText('May Weekly Cup')).toBeInTheDocument();
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    expect(screen.getByText('ENDED')).toBeInTheDocument();
  });

  it('links each row to /games/:id', () => {
    gamesData.length = 0;
    gamesData.push({
      id: 'g1',
      name: 'Friday Night Bloodbath',
      status: 'active',
      startingBalance: 100000,
      startDate: '2026-05-12T00:00:00Z',
      endDate: '2026-05-25T23:59:59Z',
    });
    render(wrap(<GamesListPage />));
    const link = screen.getByRole('link', { name: /friday night bloodbath/i });
    expect(link).toHaveAttribute('href', '/games/g1');
  });

  it('invites the viewer to act when no open games are listed', () => {
    gamesData.length = 0;
    browsableData.length = 0;
    render(wrap(<GamesListPage />));
    expect(screen.getByText('Open games')).toBeInTheDocument();
    expect(screen.getByText(/no open games right now/i)).toBeInTheDocument();
  });

  it('lists each open game with its host, players, and a join action', () => {
    gamesData.length = 0;
    browsableData.length = 0;
    browsableData.push({
      id: 'b1',
      name: 'May Weekly Cup',
      status: 'active',
      startingBalance: 50000,
      startDate: '2026-05-01T00:00:00Z',
      endDate: '2026-05-31T23:59:59Z',
      playerCount: 3,
      createdByUsername: 'alice',
      createdAt: '2026-04-28T00:00:00Z',
    });
    render(wrap(<GamesListPage />));
    expect(screen.getByText('May Weekly Cup')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /join may weekly cup/i })).toBeInTheDocument();
    expect(screen.getByText('1 listed')).toBeInTheDocument();
  });
});
