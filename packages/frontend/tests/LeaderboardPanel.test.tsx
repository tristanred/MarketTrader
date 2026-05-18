import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type React from 'react';
import { LeaderboardPanel } from '@/components/game/arena/LeaderboardPanel';
import { useAuthStore } from '@/stores/authStore';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>;
}

const ENTRIES = [
  { playerId: 'u1', username: 'marcus', rank: 1, totalValue: 128430.55, cashBalance: 4210 },
  { playerId: 'u2', username: 'tristan', rank: 2, totalValue: 118902.14, cashBalance: 12402 },
  { playerId: 'u3', username: 'jules', rank: 3, totalValue: 96210.00, cashBalance: 8100 },
];

describe('LeaderboardPanel', () => {
  beforeEach(() => {
    useAuthStore.setState({
      token: 't',
      user: { id: 'u2', username: 'tristan', groups: [] },
    });
  });

  it('renders each entry with rank, username, value, and P&L%', () => {
    render(wrap(<LeaderboardPanel entries={ENTRIES} startingBalance={100000} />));
    expect(screen.getByText('marcus')).toBeInTheDocument();
    expect(screen.getByText('tristan')).toBeInTheDocument();
    expect(screen.getByText('jules')).toBeInTheDocument();
    expect(screen.getByText('+28.43%')).toBeInTheDocument();
    expect(screen.getByText('+18.90%')).toBeInTheDocument();
    expect(screen.getByText(/−3\.79%/)).toBeInTheDocument();
  });

  it('marks the current user row with data-current-user', () => {
    render(wrap(<LeaderboardPanel entries={ENTRIES} startingBalance={100000} />));
    const rows = screen.getAllByRole('listitem');
    const me = rows.find((r) => r.getAttribute('data-current-user') === 'true');
    expect(me).toBeDefined();
    expect(me!.textContent).toContain('tristan');
  });

  it('renders a LIVE indicator in the header', () => {
    render(wrap(<LeaderboardPanel entries={ENTRIES} startingBalance={100000} />));
    expect(screen.getByText('LIVE')).toBeInTheDocument();
  });

  it('renders an empty state when there are no entries', () => {
    render(wrap(<LeaderboardPanel entries={[]} startingBalance={100000} />));
    expect(screen.getByText(/no players/i)).toBeInTheDocument();
  });
});
