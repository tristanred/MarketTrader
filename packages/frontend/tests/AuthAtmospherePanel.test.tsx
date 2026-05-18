import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type React from 'react';
import { AuthAtmospherePanel } from '@/components/auth/AuthAtmospherePanel';
import type { FeaturedGame } from '@markettrader/shared';

const SAMPLE: FeaturedGame[] = [
  {
    id: 'g1',
    name: 'my-game',
    dayCurrent: 6,
    dayTotal: 12,
    leaderboard: [
      { rank: 1, username: 'tristan', totalValue: 128430, pnlPct: 28.43 },
      { rank: 2, username: 'marcus', totalValue: 118902, pnlPct: 18.9 },
      { rank: 3, username: 'jules', totalValue: 96210, pnlPct: -3.79 },
    ],
  },
];

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

beforeEach(() => {
  // The panel calls fetch('/api/public/featured-games'); resolve with SAMPLE.
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => SAMPLE,
  })) as unknown as typeof fetch;
});

describe('AuthAtmospherePanel', () => {
  it('renders the brand mark "MarketTrader"', () => {
    render(wrap(<AuthAtmospherePanel />));
    expect(screen.getByText('MarketTrader')).toBeInTheDocument();
  });

  it('renders top-tournament rows fetched from the public endpoint', async () => {
    render(wrap(<AuthAtmospherePanel />));
    expect(await screen.findByText(/tristan/i)).toBeInTheDocument();
    expect(screen.getByText(/marcus/i)).toBeInTheDocument();
    expect(screen.getByText(/jules/i)).toBeInTheDocument();
    expect(screen.getByText('my-game')).toBeInTheDocument();
    expect(screen.getByText(/DAY 6\/12/i)).toBeInTheDocument();
  });

  it('renders a faux ticker strip with an index symbol', () => {
    render(wrap(<AuthAtmospherePanel />));
    expect(screen.getByText('^GSPC')).toBeInTheDocument();
  });

  it('marks the whole panel as decorative via aria-hidden', () => {
    const { container } = render(wrap(<AuthAtmospherePanel />));
    const root = container.firstElementChild;
    expect(root?.getAttribute('aria-hidden')).toBe('true');
  });
});
