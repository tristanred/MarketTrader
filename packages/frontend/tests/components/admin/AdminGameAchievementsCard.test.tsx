import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type React from 'react';

const unlockMutate = vi.fn().mockResolvedValue({});
const resetMutate = vi.fn().mockResolvedValue({});
const setProgressMutate = vi.fn().mockResolvedValue({});
const setEnabledMutate = vi.fn().mockResolvedValue({});

vi.mock('@/api/admin/achievements', () => ({
  useAdminGameAchievements: () => ({
    data: {
      definitions: [
        { key: 'first-trade', name: 'First Trade', description: '', rarity: 'common', icon: 'x', target: 1, enabled: true },
        { key: 'ten-buys', name: 'Ten Buys', description: '', rarity: 'common', icon: 'x', target: 10, enabled: true },
      ],
      rows: [
        { gamePlayerId: 'gp1', achievementKey: 'first-trade', progress: 1, target: 1, unlockedAt: '2026-05-23T12:00:00.000Z', orphaned: false },
        { gamePlayerId: 'gp1', achievementKey: 'ten-buys', progress: 4, target: 10, unlockedAt: null, orphaned: false },
      ],
    },
    isLoading: false,
    isError: false,
  }),
  useAdminGlobalAchievements: () => ({
    data: {
      definitions: [
        { key: 'first-trade', name: 'First Trade', description: '', rarity: 'common', icon: 'x', target: 1, enabled: true },
        { key: 'ten-buys', name: 'Ten Buys', description: '', rarity: 'common', icon: 'x', target: 10, enabled: false },
      ],
    },
    isLoading: false,
  }),
  useAdminUnlockAchievement: () => ({ mutateAsync: unlockMutate, isPending: false }),
  useAdminResetAchievement: () => ({ mutateAsync: resetMutate, isPending: false }),
  useAdminSetAchievementProgress: () => ({ mutateAsync: setProgressMutate, isPending: false }),
  useAdminSetGameAchievementEnabled: () => ({ mutateAsync: setEnabledMutate, isPending: false }),
}));

vi.mock('@/api/admin/games', () => ({
  useAdminGamePlayers: () => ({
    data: { players: [{ playerId: 'gp1', userId: 'u1', username: 'alice', cashBalance: 100, joinedAt: '' }] },
    isLoading: false,
  }),
}));

import { AdminGameAchievementsCard } from '@/components/admin/AdminGameAchievementsCard';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe('AdminGameAchievementsCard', () => {
  beforeEach(() => {
    unlockMutate.mockClear();
    resetMutate.mockClear();
    setProgressMutate.mockClear();
    setEnabledMutate.mockClear();
  });

  it('renders one accordion per player with progress strings', () => {
    render(wrap(<AdminGameAchievementsCard gameId="g1" />));
    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.getByText(/1 \/ 2 unlocked/)).toBeInTheDocument();
    expect(screen.getByText(/Unlocked 2026-05-23/)).toBeInTheDocument();
    expect(screen.getByText('4 / 10')).toBeInTheDocument();
  });

  it('disables the Unlock button on an already-unlocked row', () => {
    render(wrap(<AdminGameAchievementsCard gameId="g1" />));
    // The first row (First Trade) is unlocked. Find its row and locate the Unlock button within it.
    const cells = screen.getAllByRole('row');
    const firstTradeRow = cells.find((r) => within(r).queryByText('First Trade'));
    expect(firstTradeRow).toBeDefined();
    const unlockBtn = within(firstTradeRow!).getByRole('button', { name: 'Unlock' });
    expect(unlockBtn).toBeDisabled();
  });

  it('opens the confirm dialog and calls the unlock mutation', async () => {
    const user = userEvent.setup();
    render(wrap(<AdminGameAchievementsCard gameId="g1" />));
    const cells = screen.getAllByRole('row');
    const tenBuysRow = cells.find((r) => within(r).queryByText('Ten Buys'));
    const unlockBtn = within(tenBuysRow!).getByRole('button', { name: 'Unlock' });
    await user.click(unlockBtn);

    // Confirm dialog appears
    expect(await screen.findByText(/Force-unlock Ten Buys/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Unlock' }));

    expect(unlockMutate).toHaveBeenCalledWith({ gamePlayerId: 'gp1', key: 'ten-buys' });
  });

  it('opens the inline editor and submits set-progress', async () => {
    const user = userEvent.setup();
    render(wrap(<AdminGameAchievementsCard gameId="g1" />));
    const cells = screen.getAllByRole('row');
    const tenBuysRow = cells.find((r) => within(r).queryByText('Ten Buys'));
    await user.click(within(tenBuysRow!).getByRole('button', { name: 'Set…' }));

    const input = within(tenBuysRow!).getByRole('spinbutton');
    await user.clear(input);
    await user.type(input, '7');
    await user.click(within(tenBuysRow!).getByRole('button', { name: 'Save' }));

    expect(setProgressMutate).toHaveBeenCalledWith({
      gamePlayerId: 'gp1',
      key: 'ten-buys',
      progress: 7,
    });
  });

  it('disables the per-game toggle for globally-disabled definitions', async () => {
    const user = userEvent.setup();
    render(wrap(<AdminGameAchievementsCard gameId="g1" />));
    // Open the per-game toggles section.
    await user.click(screen.getByText(/Per-game toggles/));

    // Each definition is in a <label> — locate by its name text.
    const tenBuysLabel = screen.getByText('Ten Buys', { selector: 'label > span' });
    const tenBuysCheckbox = tenBuysLabel.parentElement?.querySelector('input[type="checkbox"]');
    expect(tenBuysCheckbox).toBeDisabled();

    const firstTradeLabel = screen.getByText('First Trade', { selector: 'label > span' });
    const firstTradeCheckbox = firstTradeLabel.parentElement?.querySelector('input[type="checkbox"]');
    expect(firstTradeCheckbox).not.toBeDisabled();
  });
});
