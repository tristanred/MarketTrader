import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import topOfTheClass from '../../../src/achievements/definitions/top-of-the-class.js';

async function fireSnapshot(
  h: Awaited<ReturnType<typeof makeAchievementHarness>>,
  rank: number,
): Promise<void> {
  await h.dispatch({
    type: 'snapshot.recorded',
    gameId: h.gameId,
    gamePlayerId: h.gamePlayerId,
    totalValue: 10000,
    rank,
    totalPlayers: 5,
    capturedAt: new Date().toISOString(),
  });
}

describe('achievement: top-of-the-class', () => {
  it('unlocks the first time rank reaches 1', async () => {
    const h = await makeAchievementHarness(topOfTheClass);
    await fireSnapshot(h, 1);
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock at rank 2', async () => {
    const h = await makeAchievementHarness(topOfTheClass);
    await fireSnapshot(h, 2);
    expect(await h.isUnlocked()).toBe(false);
  });
});
