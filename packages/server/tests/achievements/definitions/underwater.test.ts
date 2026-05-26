import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import underwater from '../../../src/achievements/definitions/underwater.js';

async function fireSnapshot(
  h: Awaited<ReturnType<typeof makeAchievementHarness>>,
  totalValue: number,
): Promise<void> {
  await h.dispatch({
    type: 'snapshot.recorded',
    gameId: h.gameId,
    gamePlayerId: h.gamePlayerId,
    totalValue,
    rank: 1,
    totalPlayers: 1,
    capturedAt: new Date().toISOString(),
  });
}

describe('achievement: underwater', () => {
  it('unlocks at exactly 50% of starting balance', async () => {
    const h = await makeAchievementHarness(underwater);
    await fireSnapshot(h, 5000);
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock just above 50%', async () => {
    const h = await makeAchievementHarness(underwater);
    await fireSnapshot(h, 5001);
    expect(await h.isUnlocked()).toBe(false);
  });

  it('unlocks well below 50%', async () => {
    const h = await makeAchievementHarness(underwater);
    await fireSnapshot(h, 1000);
    expect(await h.isUnlocked()).toBe(true);
  });
});
