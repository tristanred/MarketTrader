import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ActivityPanel, type ActivityEvent } from '@/components/game/arena/ActivityPanel';

const EVENTS: ActivityEvent[] = [
  { at: '2026-05-15T18:21:00Z', player: 'marcus', direction: 'buy', quantity: 50, symbol: 'NVDA', price: 1178.3 },
  { at: '2026-05-15T18:18:00Z', player: 'jules', direction: 'sell', quantity: 20, symbol: 'TSLA', price: 241.05 },
];

describe('ActivityPanel', () => {
  it('renders each event with player, direction, qty, symbol, and price', () => {
    render(<ActivityPanel events={EVENTS} />);
    expect(screen.getByText(/marcus/)).toBeInTheDocument();
    expect(screen.getByText(/jules/)).toBeInTheDocument();
    expect(screen.getByText(/BUY/)).toBeInTheDocument();
    expect(screen.getByText(/SELL/)).toBeInTheDocument();
    expect(screen.getByText(/NVDA/)).toBeInTheDocument();
    expect(screen.getByText(/1178\.30/)).toBeInTheDocument();
  });

  it('renders an empty state when there are no events', () => {
    render(<ActivityPanel events={[]} />);
    expect(screen.getByText(/no activity/i)).toBeInTheDocument();
  });
});
