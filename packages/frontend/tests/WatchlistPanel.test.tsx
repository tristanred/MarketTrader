import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { WatchlistPanel, type WatchlistRow } from '@/components/game/arena/WatchlistPanel';

const ROWS: WatchlistRow[] = [
  { symbol: 'AAPL', last: 189.42, changePct: 0.84 },
  { symbol: 'NVDA', last: 1178.3, changePct: 2.41 },
  { symbol: 'TSLA', last: 241.05, changePct: -1.12 },
];

describe('WatchlistPanel', () => {
  it('renders each row with symbol, last, and change %', () => {
    render(<WatchlistPanel rows={ROWS} />);
    expect(screen.getByText('AAPL')).toBeInTheDocument();
    expect(screen.getByText('189.42')).toBeInTheDocument();
    expect(screen.getByText('+0.84%')).toBeInTheDocument();
    expect(screen.getByText('−1.12%')).toBeInTheDocument();
  });

  it('calls onSelect with the chosen symbol on row click', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<WatchlistPanel rows={ROWS} onSelect={onSelect} />);
    await user.click(screen.getByText('TSLA'));
    expect(onSelect).toHaveBeenCalledWith('TSLA');
  });

  it('renders an empty state when no rows', () => {
    render(<WatchlistPanel rows={[]} />);
    expect(screen.getByText(/empty/i)).toBeInTheDocument();
  });
});
