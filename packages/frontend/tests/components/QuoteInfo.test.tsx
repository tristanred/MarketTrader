import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QuoteInfo } from '@/components/QuoteInfo';

vi.mock('@/api/stocks', () => ({
  useStockDetails: () => ({ data: undefined, isError: false }),
  useStockSearch: () => ({ data: [] }),
}));
vi.mock('@/api/market-status', () => ({ useMarketStatus: () => ({ data: undefined }) }));
vi.mock('@/api/trades', () => ({ usePortfolio: () => ({ data: undefined }) }));
vi.mock('@/components/StockChart', () => ({ ChartCanvas: () => null, RANGES: [] }));

describe('QuoteInfo TradingView link', () => {
  it('opens the symbol on TradingView in a new tab', () => {
    render(<QuoteInfo symbol="BRK-B" variant="compact" onTradeClick={vi.fn()} />);
    const link = screen.getByRole('link', { name: /view brk-b on tradingview/i });
    expect(link).toHaveAttribute('href', 'https://www.tradingview.com/symbols/BRK.B/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('is still shown when there is no Trade button', () => {
    render(<QuoteInfo symbol="AAPL" variant="full" showTradeButton={false} />);
    expect(screen.getByRole('link', { name: /view aapl on tradingview/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /trade aapl/i })).toBeNull();
  });
});
