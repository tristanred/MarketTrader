import { beforeEach, describe, expect, it } from 'vitest';
import { useAchievementToastStore } from '@/stores/achievementToastStore';
import type { WsAchievementUnlockedEvent } from '@markettrader/shared';

const unlockA: WsAchievementUnlockedEvent['data'] = {
  gamePlayerId: 'gp1',
  achievementKey: 'first-trade',
  name: 'First Trade',
  description: 'Execute your first trade.',
  rarity: 'common',
  icon: 'circle-dot',
  unlockedAt: '2026-05-23T12:00:00.000Z',
};

const unlockB = { ...unlockA, achievementKey: 'ten-buys', unlockedAt: '2026-05-23T12:01:00.000Z' };

describe('achievementToastStore', () => {
  beforeEach(() => useAchievementToastStore.setState({ current: null, queue: [] }));

  it('enqueue with empty queue + null current promotes immediately to current', () => {
    useAchievementToastStore.getState().enqueue(unlockA);
    const { current, queue } = useAchievementToastStore.getState();
    expect(current?.unlock.achievementKey).toBe('first-trade');
    expect(queue).toHaveLength(0);
  });

  it('enqueue with a current toast appends to the queue', () => {
    useAchievementToastStore.getState().enqueue(unlockA);
    useAchievementToastStore.getState().enqueue(unlockB);
    const { current, queue } = useAchievementToastStore.getState();
    expect(current?.unlock.achievementKey).toBe('first-trade');
    expect(queue).toHaveLength(1);
    expect(queue[0]?.unlock.achievementKey).toBe('ten-buys');
  });

  it('de-dups by (achievementKey, unlockedAt)', () => {
    useAchievementToastStore.getState().enqueue(unlockA);
    useAchievementToastStore.getState().enqueue({ ...unlockA });
    const { current, queue } = useAchievementToastStore.getState();
    expect(current).not.toBeNull();
    expect(queue).toHaveLength(0);
  });

  it('dismiss clears current to null, leaving the next queued for promotion', () => {
    useAchievementToastStore.getState().enqueue(unlockA);
    useAchievementToastStore.getState().enqueue(unlockB);
    const firstId = useAchievementToastStore.getState().current!.id;
    useAchievementToastStore.getState().dismiss(firstId);
    const { current, queue } = useAchievementToastStore.getState();
    expect(current).toBeNull();
    expect(queue).toHaveLength(1);
    expect(queue[0]?.unlock.achievementKey).toBe('ten-buys');
  });

  it('promoteNext pulls the queue head into an empty current slot', () => {
    useAchievementToastStore.getState().enqueue(unlockA);
    useAchievementToastStore.getState().enqueue(unlockB);
    const firstId = useAchievementToastStore.getState().current!.id;
    useAchievementToastStore.getState().dismiss(firstId);
    useAchievementToastStore.getState().promoteNext();
    const { current, queue } = useAchievementToastStore.getState();
    expect(current?.unlock.achievementKey).toBe('ten-buys');
    expect(queue).toHaveLength(0);
  });

  it('promoteNext is a no-op while a toast is still showing', () => {
    useAchievementToastStore.getState().enqueue(unlockA);
    useAchievementToastStore.getState().enqueue(unlockB);
    useAchievementToastStore.getState().promoteNext();
    const { current, queue } = useAchievementToastStore.getState();
    expect(current?.unlock.achievementKey).toBe('first-trade');
    expect(queue).toHaveLength(1);
  });

  it('an unlock arriving mid-gap (current null, queue non-empty) appends, never jumps the line', () => {
    useAchievementToastStore.getState().enqueue(unlockA);
    useAchievementToastStore.getState().enqueue(unlockB);
    const firstId = useAchievementToastStore.getState().current!.id;
    useAchievementToastStore.getState().dismiss(firstId); // current → null, queue = [B]

    const unlockC = { ...unlockA, achievementKey: 'whale', unlockedAt: '2026-05-23T12:02:00.000Z' };
    useAchievementToastStore.getState().enqueue(unlockC);

    const { current, queue } = useAchievementToastStore.getState();
    expect(current).toBeNull();
    expect(queue.map((t) => t.unlock.achievementKey)).toEqual(['ten-buys', 'whale']);
  });

  it('promoteNext is a no-op when the queue is empty', () => {
    useAchievementToastStore.getState().enqueue(unlockA);
    const firstId = useAchievementToastStore.getState().current!.id;
    useAchievementToastStore.getState().dismiss(firstId);
    useAchievementToastStore.getState().promoteNext();
    expect(useAchievementToastStore.getState().current).toBeNull();
  });

  it('dismiss on an outdated id is a no-op', () => {
    useAchievementToastStore.getState().enqueue(unlockA);
    useAchievementToastStore.getState().dismiss('not-a-real-id');
    expect(useAchievementToastStore.getState().current).not.toBeNull();
  });
});
