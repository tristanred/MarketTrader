import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PortfolioPanel } from '@/components/game/arena/PortfolioPanel';

describe('PortfolioPanel', () => {
  it('renders all four stats with values', () => {
    render(
      <PortfolioPanel
        value={118902.14}
        pnlPct={18.9}
        cash={12402}
        dayPnl={1204.18}
      />,
    );
    expect(screen.getByText('$118,902.14')).toBeInTheDocument();
    expect(screen.getByText('+18.90%')).toBeInTheDocument();
    expect(screen.getByText('$12,402.00')).toBeInTheDocument();
    expect(screen.getByText('+$1,204.18')).toBeInTheDocument();
  });

  it('uses gain color when P&L is positive', () => {
    render(<PortfolioPanel value={100} pnlPct={5} cash={0} dayPnl={1} />);
    expect(screen.getByText('+5.00%').className).toMatch(/text-gain/);
    expect(screen.getByText('+$1.00').className).toMatch(/text-gain/);
  });

  it('uses loss color when P&L is negative', () => {
    render(<PortfolioPanel value={100} pnlPct={-5} cash={0} dayPnl={-1} />);
    expect(screen.getByText('−5.00%').className).toMatch(/text-loss/);
    expect(screen.getByText('−$1.00').className).toMatch(/text-loss/);
  });

  it('renders the panel header label "Your portfolio"', () => {
    render(<PortfolioPanel value={100} pnlPct={0} cash={0} dayPnl={0} />);
    expect(screen.getByText(/your portfolio/i)).toBeInTheDocument();
  });
});
