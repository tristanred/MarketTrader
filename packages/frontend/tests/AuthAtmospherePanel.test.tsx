import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { AuthAtmospherePanel } from '@/components/auth/AuthAtmospherePanel';

describe('AuthAtmospherePanel', () => {
  it('renders the brand mark "MarketTrader"', () => {
    render(<AuthAtmospherePanel />);
    expect(screen.getByText('MarketTrader')).toBeInTheDocument();
  });

  it('renders at least three faux leaderboard rows', () => {
    render(<AuthAtmospherePanel />);
    expect(screen.getByText(/tristan/i)).toBeInTheDocument();
    expect(screen.getByText(/marcus/i)).toBeInTheDocument();
    expect(screen.getByText(/jules/i)).toBeInTheDocument();
  });

  it('renders a faux ticker strip with an index symbol', () => {
    render(<AuthAtmospherePanel />);
    expect(screen.getByText('^GSPC')).toBeInTheDocument();
  });

  it('marks the whole panel as decorative via aria-hidden', () => {
    const { container } = render(<AuthAtmospherePanel />);
    const root = container.firstElementChild;
    expect(root?.getAttribute('aria-hidden')).toBe('true');
  });
});
