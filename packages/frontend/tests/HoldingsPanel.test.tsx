import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { HoldingsPanel, type HoldingRow } from '@/components/game/arena/HoldingsPanel';

const ROWS: HoldingRow[] = [
  { symbol: 'AAPL', name: 'Apple Inc.', quantity: 120, avgCost: 175, marketValue: 22730.4, pnlPct: 8.24 },
  { symbol: 'NVDA', name: 'Nvidia', quantity: 40, avgCost: 950, marketValue: 47132, pnlPct: 24.03 },
];

describe('HoldingsPanel', () => {
  it('renders one row per holding with all columns', () => {
    render(<HoldingsPanel rows={ROWS} />);
    expect(screen.getByText('AAPL')).toBeInTheDocument();
    expect(screen.getByText('Apple Inc.')).toBeInTheDocument();
    expect(screen.getByText('NVDA')).toBeInTheDocument();
    expect(screen.getByText('Nvidia')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.getByText('+8.24%')).toBeInTheDocument();
    expect(screen.getByText('+24.03%')).toBeInTheDocument();
  });

  it('calls onSelect with the chosen symbol on row click', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<HoldingsPanel rows={ROWS} onSelect={onSelect} />);
    await user.click(screen.getByText('NVDA'));
    expect(onSelect).toHaveBeenCalledWith('NVDA');
  });

  it('renders an empty state when there are no holdings', () => {
    render(<HoldingsPanel rows={[]} />);
    expect(screen.getByText(/no holdings/i)).toBeInTheDocument();
  });

  it('uses loss color for negative P&L', () => {
    render(<HoldingsPanel rows={[{ ...ROWS[0]!, pnlPct: -3.5 }]} />);
    expect(screen.getByText('−3.50%').className).toMatch(/text-loss/);
  });
});
