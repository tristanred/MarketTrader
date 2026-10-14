import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { DiscoverResponse } from '@markettrader/shared';
import { DiscoverPanel } from '@/components/game/arena/DiscoverPanel';

let state: { data?: DiscoverResponse; isLoading?: boolean; isError?: boolean } = {};
vi.mock('@/api/discover', () => ({
  useDiscover: () => ({ data: undefined, isLoading: false, isError: false, ...state }),
}));

const renderPanel = (onSelect = vi.fn()) =>
  render(
    <MemoryRouter>
      <DiscoverPanel gameId="g1" onSelect={onSelect} />
    </MemoryRouter>,
  );

beforeEach(() => {
  state = {};
});

describe('DiscoverPanel', () => {
  it('shows three labelled stocks and links to the full page', async () => {
    state = {
      data: {
        status: 'ready',
        list: {
          gameId: 'g1',
          sessionDate: '2026-05-18',
          generatedAt: '2026-05-18T20:05:00Z',
          sections: [
            {
              kind: 'picks',
              items: [
                { symbol: 'XOM', name: 'Exxon', price: 1, changePct: 1, sector: 'Energy' },
                {
                  symbol: 'KO',
                  name: 'Coca-Cola',
                  price: 1,
                  changePct: -1,
                  sector: 'Consumer Staples',
                },
              ],
            },
            { kind: 'gainers', items: [{ symbol: 'SMCI', name: null, price: 1, changePct: 9 }] },
          ],
        },
      },
    };
    const onSelect = vi.fn();
    renderPanel(onSelect);

    // No most-active list, so the third row is topped up from the picks.
    const rows = screen.getAllByRole('button');
    expect(rows.map((r) => r.textContent)).toEqual([
      'XOMDaily pick+1.00%',
      'SMCITop gainer+9.00%',
      'KODaily pick-1.00%',
    ]);
    expect(screen.getByRole('link', { name: /see all/i })).toHaveAttribute(
      'href',
      '/games/g1/discover',
    );

    await userEvent.click(screen.getByRole('button', { name: /SMCI/ }));
    expect(onSelect).toHaveBeenCalledWith('SMCI');
  });

  it('says the picks are on the way while preparing', () => {
    state = { data: { status: 'preparing' } };
    renderPanel();
    expect(screen.getByText(/on the way/)).toBeInTheDocument();
  });

  it('hides itself once the game has ended or on error', () => {
    state = { data: { status: 'ended' } };
    const { container, rerender } = renderPanel();
    expect(container).toBeEmptyDOMElement();

    state = { isError: true };
    rerender(
      <MemoryRouter>
        <DiscoverPanel gameId="g1" onSelect={vi.fn()} />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
