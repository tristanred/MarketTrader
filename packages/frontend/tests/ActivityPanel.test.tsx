import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ActivityPanel, type ActivityEvent } from '@/components/game/arena/ActivityPanel';

const EVENTS: ActivityEvent[] = [
  { kind: 'trade', at: '2026-05-15T18:21:00Z', player: 'marcus', direction: 'buy', quantity: 50, symbol: 'NVDA', price: 1178.3 },
  { kind: 'trade', at: '2026-05-15T18:18:00Z', player: 'jules', direction: 'sell', quantity: 20, symbol: 'TSLA', price: 241.05 },
];

describe('ActivityPanel', () => {
  it('renders each trade event with player, direction, qty, symbol, and price', () => {
    render(<ActivityPanel events={EVENTS} />);
    expect(screen.getByText(/marcus/)).toBeInTheDocument();
    expect(screen.getByText(/jules/)).toBeInTheDocument();
    expect(screen.getByText(/BUY/)).toBeInTheDocument();
    expect(screen.getByText(/SELL/)).toBeInTheDocument();
    expect(screen.getByText(/NVDA/)).toBeInTheDocument();
    expect(screen.getByText(/1178\.30/)).toBeInTheDocument();
  });

  it('renders achievement rows alongside trade rows', () => {
    const mixed: ActivityEvent[] = [
      ...EVENTS,
      {
        kind: 'achievement',
        id: 'gp1:first-blood',
        at: '2026-05-15T18:20:00Z',
        player: 'amelia',
        achievementKey: 'first-blood',
        name: 'First Blood',
        rarity: 'common',
        icon: 'flame',
      },
    ];
    render(<ActivityPanel events={mixed} />);
    expect(screen.getByText('amelia')).toBeInTheDocument();
    expect(screen.getByText(/unlocked/)).toBeInTheDocument();
    expect(screen.getByText('First Blood')).toBeInTheDocument();
  });

  it('renders an empty state when there are no events', () => {
    render(<ActivityPanel events={[]} />);
    expect(screen.getByText(/no activity/i)).toBeInTheDocument();
  });
});
