import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AchievementToast } from '@/components/achievements/AchievementToast';
import { useAchievementToastStore } from '@/stores/achievementToastStore';
import type { WsAchievementUnlockedEvent } from '@markettrader/shared';

vi.mock('@/api/achievements', () => ({
  ackAchievementUnlock: vi.fn().mockResolvedValue(undefined),
}));

const unlock: WsAchievementUnlockedEvent['data'] = {
  gamePlayerId: 'gp1',
  achievementKey: 'diamond-hands',
  name: 'Diamond Hands',
  description: 'Hold a single position from start to finish.',
  rarity: 'legendary',
  icon: 'gem',
  unlockedAt: '2026-05-23T12:00:00.000Z',
};

describe('AchievementToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAchievementToastStore.setState({ current: null, queue: [] });
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders the rarity eyebrow + name', () => {
    render(<AchievementToast gameId="g1" toast={{ id: 't1', unlock, enqueuedAt: 0 }} />);
    expect(screen.getByText(/legendary · unlocked/i)).toBeInTheDocument();
    expect(screen.getByText('Diamond Hands')).toBeInTheDocument();
  });

  it('shows relative-time suffix when replayed=true', () => {
    const replayed = { ...unlock, replayed: true, unlockedAt: new Date(Date.now() - 7_200_000).toISOString() };
    render(<AchievementToast gameId="g1" toast={{ id: 't1', unlock: replayed, enqueuedAt: 0 }} />);
    expect(screen.getByText(/2h ago/i)).toBeInTheDocument();
  });

  it('dismisses on × click and calls dismiss(id) on the store', () => {
    const dismissSpy = vi.fn();
    useAchievementToastStore.setState({
      current: { id: 't1', unlock, enqueuedAt: 0 },
      queue: [],
      enqueue: useAchievementToastStore.getState().enqueue,
      dismiss: dismissSpy,
    });
    render(<AchievementToast gameId="g1" toast={{ id: 't1', unlock, enqueuedAt: 0 }} />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    vi.advanceTimersByTime(300);
    expect(dismissSpy).toHaveBeenCalledWith('t1');
  });

  it('auto-dismisses after the 6s display window', () => {
    const dismissSpy = vi.fn();
    useAchievementToastStore.setState({
      current: { id: 't1', unlock, enqueuedAt: 0 },
      queue: [],
      enqueue: useAchievementToastStore.getState().enqueue,
      dismiss: dismissSpy,
    });
    render(<AchievementToast gameId="g1" toast={{ id: 't1', unlock, enqueuedAt: 0 }} />);
    vi.advanceTimersByTime(6300);
    expect(dismissSpy).toHaveBeenCalledWith('t1');
  });
});
