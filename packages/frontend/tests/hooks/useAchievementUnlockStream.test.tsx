import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAchievementUnlockStream } from '@/hooks/useAchievementUnlockStream';
import { useAchievementToastStore } from '@/stores/achievementToastStore';
import { advanceSeenMarker } from '@/lib/achievementSeenMarker';
import type { WsAchievementUnlockedEvent } from '@markettrader/shared';

const baseUnlock: WsAchievementUnlockedEvent['data'] = {
  gamePlayerId: 'gp1',
  achievementKey: 'first-trade',
  name: 'First Trade',
  description: 'Execute your first trade.',
  rarity: 'common',
  icon: 'circle-dot',
  unlockedAt: '2026-05-23T12:00:00.000Z',
};

describe('useAchievementUnlockStream', () => {
  beforeEach(() => {
    localStorage.clear();
    useAchievementToastStore.setState({ current: null, queue: [] });
  });
  afterEach(() => vi.restoreAllMocks());

  it('enqueues own-unlocks via the global hook bridge', () => {
    const { result } = renderHook(() => useAchievementUnlockStream('g1', 'gp1'));
    act(() => result.current.handle(baseUnlock));
    expect(useAchievementToastStore.getState().current?.unlock.achievementKey).toBe('first-trade');
  });

  it('drops peer unlocks (different gamePlayerId)', () => {
    const { result } = renderHook(() => useAchievementUnlockStream('g1', 'gp1'));
    act(() => result.current.handle({ ...baseUnlock, gamePlayerId: 'gp2' }));
    expect(useAchievementToastStore.getState().current).toBeNull();
  });

  it('drops unlocks <= localStorage marker', () => {
    advanceSeenMarker('g1', 'gp1', baseUnlock.unlockedAt);
    const { result } = renderHook(() => useAchievementUnlockStream('g1', 'gp1'));
    act(() => result.current.handle(baseUnlock));
    expect(useAchievementToastStore.getState().current).toBeNull();
  });

  it('enqueues unlocks newer than the marker', () => {
    advanceSeenMarker('g1', 'gp1', '2026-05-23T11:00:00.000Z');
    const { result } = renderHook(() => useAchievementUnlockStream('g1', 'gp1'));
    act(() => result.current.handle(baseUnlock));
    expect(useAchievementToastStore.getState().current?.unlock.achievementKey).toBe('first-trade');
  });
});
