import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import indexFund from '../../../src/achievements/definitions/index-fund.js';

async function fireHoldings(
  h: Awaited<ReturnType<typeof makeAchievementHarness>>,
  distinctSymbols: number,
): Promise<void> {
  await h.dispatch({
    type: 'holdings.changed',
    gameId: h.gameId,
    gamePlayerId: h.gamePlayerId,
    distinctSymbols,
    topConcentrationRatio: 0,
    cashRatio: 0.5,
    changedAt: new Date().toISOString(),
  });
}

describe('achievement: index-fund', () => {
  it('unlocks at distinctSymbols = 20', async () => {
    const h = await makeAchievementHarness(indexFund);
    await fireHoldings(h, 20);
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock at distinctSymbols = 19', async () => {
    const h = await makeAchievementHarness(indexFund);
    await fireHoldings(h, 19);
    expect(await h.isUnlocked()).toBe(false);
  });
});
