import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AchievementGrid } from '@/components/achievements/AchievementGrid';
import type { AchievementDefinitionDTO } from '@markettrader/shared';

const defs: AchievementDefinitionDTO[] = [
  { key: 't1', name: 'Trader One', description: 't1', rarity: 'common', icon: 'x', target: 1, enabled: true, category: 'trading' },
  { key: 't2', name: 'Trader Two', description: 't2', rarity: 'common', icon: 'x', target: 1, enabled: true, category: 'trading' },
  { key: 'p1', name: 'Pnl One',    description: 'p1', rarity: 'common', icon: 'x', target: 1, enabled: true, category: 'pnl' },
  { key: 'f1', name: 'Finale One', description: 'f1', rarity: 'common', icon: 'x', target: 1, enabled: true, category: 'finale' },
];

function renderGrid() {
  return render(
    <MemoryRouter>
      <AchievementGrid definitions={defs} progress={[]} />
    </MemoryRouter>,
  );
}

describe('AchievementGrid category filter', () => {
  it('renders the category chip row with the expected labels', () => {
    renderGrid();
    const trading = screen.getByRole('button', { name: 'Trading' });
    expect(trading).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'P&L' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Portfolio' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Standing' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Behavior' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finale' })).toBeInTheDocument();
  });

  it('filters displayed cards to the selected category', async () => {
    const user = userEvent.setup();
    renderGrid();
    expect(screen.getByText('Trader One')).toBeInTheDocument();
    expect(screen.getByText('Pnl One')).toBeInTheDocument();
    expect(screen.getByText('Finale One')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Trading' }));

    expect(screen.getByText('Trader One')).toBeInTheDocument();
    expect(screen.getByText('Trader Two')).toBeInTheDocument();
    expect(screen.queryByText('Pnl One')).not.toBeInTheDocument();
    expect(screen.queryByText('Finale One')).not.toBeInTheDocument();
  });

  it('clicking All in the category row clears the category filter', async () => {
    const user = userEvent.setup();
    renderGrid();

    await user.click(screen.getByRole('button', { name: 'Finale' }));
    expect(screen.queryByText('Trader One')).not.toBeInTheDocument();
    expect(screen.getByText('Finale One')).toBeInTheDocument();

    // There are two "All" chips (rarity row + category row). The category row "All"
    // is the second one in DOM order, since the category row is below the rarity row.
    const allButtons = screen.getAllByRole('button', { name: 'All' });
    expect(allButtons).toHaveLength(2);
    const categoryAll = allButtons[1];
    if (!categoryAll) throw new Error('expected category All chip');
    await user.click(categoryAll);

    expect(screen.getByText('Trader One')).toBeInTheDocument();
    expect(screen.getByText('Pnl One')).toBeInTheDocument();
    expect(screen.getByText('Finale One')).toBeInTheDocument();
  });

  it('supports multi-select across categories', async () => {
    const user = userEvent.setup();
    renderGrid();

    await user.click(screen.getByRole('button', { name: 'Trading' }));
    await user.click(screen.getByRole('button', { name: 'P&L' }));

    expect(screen.getByText('Trader One')).toBeInTheDocument();
    expect(screen.getByText('Pnl One')).toBeInTheDocument();
    expect(screen.queryByText('Finale One')).not.toBeInTheDocument();
  });
});
