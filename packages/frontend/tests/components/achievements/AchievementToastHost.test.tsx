import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AchievementToastHost } from '@/components/achievements/AchievementToastHost';
import { useAchievementToastStore } from '@/stores/achievementToastStore';
import type { WsAchievementUnlockedEvent } from '@markettrader/shared';

vi.mock('@/api/achievements', () => ({
  ackAchievementUnlock: vi.fn().mockResolvedValue(undefined),
}));

const unlockA: WsAchievementUnlockedEvent['data'] = {
  gamePlayerId: 'gp1',
  achievementKey: 'first-trade',
  name: 'First Trade',
  description: 'Execute your first trade.',
  rarity: 'common',
  icon: 'circle-dot',
  unlockedAt: '2026-05-23T12:00:00.000Z',
};
const unlockB: WsAchievementUnlockedEvent['data'] = {
  ...unlockA,
  achievementKey: 'ten-buys',
  name: 'Ten Buys',
  description: 'Place ten buy orders.',
  unlockedAt: '2026-05-23T12:00:00.001Z',
};

function renderHost() {
  return render(
    <MemoryRouter initialEntries={['/games/g1']}>
      <Routes>
        <Route path="/games/:gameId" element={<AchievementToastHost />} />
      </Routes>
    </MemoryRouter>,
  );
}

function enqueueBoth() {
  act(() => {
    useAchievementToastStore.getState().enqueue(unlockA);
    useAchievementToastStore.getState().enqueue(unlockB);
  });
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('AchievementToastHost — serial playback of a multi-unlock stack', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAchievementToastStore.setState({ current: null, queue: [] });
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('auto-advances to the second toast after a gap, without a reload', () => {
    renderHost();
    enqueueBoth();

    // First toast is showing.
    expect(screen.getByText('First Trade')).toBeInTheDocument();
    expect(screen.queryByText('Ten Buys')).not.toBeInTheDocument();

    // Display window (6s) + exit animation (220ms) → first toast dismissed.
    advance(6_000 + 220);

    // During the inter-toast gap, nothing is shown.
    expect(screen.queryByText('First Trade')).not.toBeInTheDocument();
    expect(screen.queryByText('Ten Buys')).not.toBeInTheDocument();

    // After the ~1s gap, the second toast appears automatically.
    advance(1_000);
    expect(screen.getByText('Ten Buys')).toBeInTheDocument();
  });

  it('second toast plays its full entrance (not stuck in the exit state)', () => {
    const { container } = renderHost();
    enqueueBoth();

    // Step through the lifecycle in beats so each scheduled timer commits
    // before the next advance, matching how the timers fire in real time.
    advance(6_000); // first toast display window elapses → exit begins
    advance(220); // exit animation → dismiss → current = null
    advance(1_000); // inter-toast gap → promoteNext → second toast mounts

    const toast = screen.getByText('Ten Buys').closest('[role="status"]');
    expect(toast).not.toBeNull();
    // The freeze bug renders the promoted toast with the exit class (sticky
    // `exiting=true` from the previous instance). A fresh toast must not.
    expect(toast?.className).not.toMatch(/toastExit/);
    expect(container.querySelector('[class*="toastExit"]')).toBeNull();
  });

  it('manual × dismiss advances to the next toast immediately, skipping the gap', () => {
    renderHost();
    enqueueBoth();

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    });
    // Only the exit animation elapses — no 1s gap for the × path.
    advance(220);

    expect(screen.queryByText('First Trade')).not.toBeInTheDocument();
    expect(screen.getByText('Ten Buys')).toBeInTheDocument();
  });

  it('drains the entire stack to empty', () => {
    renderHost();
    enqueueBoth();

    // First toast: display + exit + gap → second toast mounts.
    advance(6_000);
    advance(220);
    advance(1_000);
    // Second toast: display + exit → current = null, queue empty.
    advance(6_000);
    advance(220);

    expect(screen.queryByText('First Trade')).not.toBeInTheDocument();
    expect(screen.queryByText('Ten Buys')).not.toBeInTheDocument();
    const { current, queue } = useAchievementToastStore.getState();
    expect(current).toBeNull();
    expect(queue).toHaveLength(0);
  });
});
