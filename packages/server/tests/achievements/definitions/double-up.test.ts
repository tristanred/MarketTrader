import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import doubleUp from '../../../src/achievements/definitions/double-up.js';

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

describe('achievement: double-up', () => {
  it('unlocks at exactly 2x starting balance', async () => {
    const h = await makeAchievementHarness(doubleUp);
    await fireSnapshot(h, 20000);
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock just below 2x', async () => {
    const h = await makeAchievementHarness(doubleUp);
    await fireSnapshot(h, 19999);
    expect(await h.isUnlocked()).toBe(false);
  });

  it('unlocks well above 2x', async () => {
    const h = await makeAchievementHarness(doubleUp);
    await fireSnapshot(h, 50000);
    expect(await h.isUnlocked()).toBe(true);
  });
});
