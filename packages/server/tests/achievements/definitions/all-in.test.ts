import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import allIn from '../../../src/achievements/definitions/all-in.js';

async function fireHoldings(
  h: Awaited<ReturnType<typeof makeAchievementHarness>>,
  topConcentrationRatio: number,
): Promise<void> {
  await h.dispatch({
    type: 'holdings.changed',
    gameId: h.gameId,
    gamePlayerId: h.gamePlayerId,
    distinctSymbols: 1,
    topConcentrationRatio,
    cashRatio: 1 - topConcentrationRatio,
    changedAt: new Date().toISOString(),
  });
}

describe('achievement: all-in', () => {
  it('unlocks at topConcentrationRatio = 0.9', async () => {
    const h = await makeAchievementHarness(allIn);
    await fireHoldings(h, 0.9);
    expect(await h.isUnlocked()).toBe(true);
  });

  it('unlocks at topConcentrationRatio = 1.0', async () => {
    const h = await makeAchievementHarness(allIn);
    await fireHoldings(h, 1.0);
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock at topConcentrationRatio = 0.89', async () => {
    const h = await makeAchievementHarness(allIn);
    await fireHoldings(h, 0.89);
    expect(await h.isUnlocked()).toBe(false);
  });
});
