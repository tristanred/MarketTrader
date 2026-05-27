import { beforeEach, describe, expect, it } from 'vitest';
import {
  useActivityFeedStore,
  type AchievementActivityEvent,
} from '@/stores/activityFeedStore';

const e1: AchievementActivityEvent = {
  gamePlayerId: 'gp1',
  achievementKey: 'first-trade',
  name: 'First Trade',
  rarity: 'common',
  icon: 'circle-dot',
  unlockedAt: '2026-05-23T12:00:00.000Z',
};

const e2: AchievementActivityEvent = {
  gamePlayerId: 'gp2',
  achievementKey: 'first-trade',
  name: 'First Trade',
  rarity: 'common',
  icon: 'circle-dot',
  unlockedAt: '2026-05-23T12:01:00.000Z',
};

describe('activityFeedStore', () => {
  beforeEach(() => {
    useActivityFeedStore.setState({ unlocks: {} });
  });

  it('addUnlock dedupes by (gamePlayerId, achievementKey)', () => {
    useActivityFeedStore.getState().addUnlock('g1', e1);
    useActivityFeedStore.getState().addUnlock('g1', e1);
    expect(useActivityFeedStore.getState().unlocks['g1']).toHaveLength(1);
  });

  it('addUnlock keeps distinct players for the same key', () => {
    useActivityFeedStore.getState().addUnlock('g1', e1);
    useActivityFeedStore.getState().addUnlock('g1', e2);
    const entries = useActivityFeedStore.getState().unlocks['g1'] ?? [];
    expect(entries).toHaveLength(2);
  });

  it('seedUnlocks merges idempotently and preserves prior live additions', () => {
    useActivityFeedStore.getState().addUnlock('g1', e1);
    useActivityFeedStore.getState().seedUnlocks('g1', [e1, e2]);
    const entries = useActivityFeedStore.getState().unlocks['g1'] ?? [];
    expect(entries).toHaveLength(2);
  });

  it('isolates per-game state', () => {
    useActivityFeedStore.getState().addUnlock('g1', e1);
    useActivityFeedStore.getState().addUnlock('g2', e2);
    expect(useActivityFeedStore.getState().unlocks['g1']).toHaveLength(1);
    expect(useActivityFeedStore.getState().unlocks['g2']).toHaveLength(1);
  });

  it('resetForGame clears just that game', () => {
    useActivityFeedStore.getState().addUnlock('g1', e1);
    useActivityFeedStore.getState().addUnlock('g2', e2);
    useActivityFeedStore.getState().resetForGame('g1');
    expect(useActivityFeedStore.getState().unlocks['g1']).toBeUndefined();
    expect(useActivityFeedStore.getState().unlocks['g2']).toHaveLength(1);
  });
});
