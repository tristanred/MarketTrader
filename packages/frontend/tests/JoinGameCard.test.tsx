import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type React from 'react';

const joinMutate = vi.fn().mockResolvedValue({});
vi.mock('@/api/games', () => ({
  useJoinGame: () => ({ mutateAsync: joinMutate, isPending: false }),
}));

import { JoinGameCard } from '@/components/game/arena/JoinGameCard';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>;
}

describe('JoinGameCard', () => {
  it('renders a Join button and the explanatory text', () => {
    render(wrap(<JoinGameCard gameId="g1" onJoined={() => {}} />));
    expect(screen.getByRole('button', { name: /join game/i })).toBeInTheDocument();
    expect(screen.getByText(/not a member/i)).toBeInTheDocument();
  });

  it('calls the join mutation + onJoined on click', async () => {
    const user = userEvent.setup();
    const onJoined = vi.fn();
    render(wrap(<JoinGameCard gameId="g1" onJoined={onJoined} />));
    await user.click(screen.getByRole('button', { name: /join game/i }));
    expect(joinMutate).toHaveBeenCalledWith('g1');
    expect(onJoined).toHaveBeenCalled();
  });
});
