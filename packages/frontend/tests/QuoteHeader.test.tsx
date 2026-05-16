import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { QuoteHeader } from '@/components/game/arena/QuoteHeader';

describe('QuoteHeader', () => {
  it('renders the symbol, last price, and percent change', () => {
    render(<QuoteHeader symbol="AAPL" last={189.42} changeAbs={1.57} changePct={0.84} />);
    expect(screen.getByText('AAPL')).toBeInTheDocument();
    expect(screen.getByText('189.42')).toBeInTheDocument();
    expect(screen.getByText(/\+0\.84%/)).toBeInTheDocument();
  });

  it('shows BUY and SELL buttons that call onTrade with direction', async () => {
    const user = userEvent.setup();
    const onTrade = vi.fn();
    render(<QuoteHeader symbol="AAPL" last={189} changeAbs={0} changePct={0} onTrade={onTrade} />);
    await user.click(screen.getByRole('button', { name: /buy/i }));
    expect(onTrade).toHaveBeenLastCalledWith('buy');
    await user.click(screen.getByRole('button', { name: /sell/i }));
    expect(onTrade).toHaveBeenLastCalledWith('sell');
  });

  it('shows an empty-state when no symbol is selected', () => {
    render(<QuoteHeader symbol={null} />);
    expect(screen.getByText(/select a symbol/i)).toBeInTheDocument();
  });

  it('disables the BUY/SELL buttons when onTrade is not provided', () => {
    render(<QuoteHeader symbol="AAPL" last={1} changeAbs={0} changePct={0} />);
    expect(screen.getByRole('button', { name: /buy/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /sell/i })).toBeDisabled();
  });

  it('preserves trailing zeros in the last price', () => {
    render(<QuoteHeader symbol="AAPL" last={189.4} changeAbs={0} changePct={0} />);
    expect(screen.getByText('189.40')).toBeInTheDocument();
  });
});
