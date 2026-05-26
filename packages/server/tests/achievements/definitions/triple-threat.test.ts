import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import tripleThreat from '../../../src/achievements/definitions/triple-threat.js';

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

describe('achievement: triple-threat', () => {
  it('unlocks at exactly 3x starting balance', async () => {
    const h = await makeAchievementHarness(tripleThreat);
    await fireSnapshot(h, 30000);
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock just below 3x', async () => {
    const h = await makeAchievementHarness(tripleThreat);
    await fireSnapshot(h, 29999);
    expect(await h.isUnlocked()).toBe(false);
  });

  it('does not unlock at double-up-tier 2x', async () => {
    const h = await makeAchievementHarness(tripleThreat);
    await fireSnapshot(h, 20000);
    expect(await h.isUnlocked()).toBe(false);
  });
});
