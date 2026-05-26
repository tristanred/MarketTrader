import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import fullyInvested from '../../../src/achievements/definitions/fully-invested.js';

async function fireHoldings(
  h: Awaited<ReturnType<typeof makeAchievementHarness>>,
  cashRatio: number,
  distinctSymbols = 1,
): Promise<void> {
  await h.dispatch({
    type: 'holdings.changed',
    gameId: h.gameId,
    gamePlayerId: h.gamePlayerId,
    distinctSymbols,
    topConcentrationRatio: 1 - cashRatio,
    cashRatio,
    changedAt: new Date().toISOString(),
  });
}

describe('achievement: fully-invested', () => {
  it('unlocks at cashRatio = 0.01 with at least one holding', async () => {
    const h = await makeAchievementHarness(fullyInvested);
    await fireHoldings(h, 0.01);
    expect(await h.isUnlocked()).toBe(true);
  });

  it('unlocks at cashRatio = 0', async () => {
    const h = await makeAchievementHarness(fullyInvested);
    await fireHoldings(h, 0);
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock at cashRatio = 0.02', async () => {
    const h = await makeAchievementHarness(fullyInvested);
    await fireHoldings(h, 0.02);
    expect(await h.isUnlocked()).toBe(false);
  });

  it('does not unlock when distinctSymbols = 0 even if cashRatio is low', async () => {
    const h = await makeAchievementHarness(fullyInvested);
    await fireHoldings(h, 0, 0);
    expect(await h.isUnlocked()).toBe(false);
  });
});
