import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import diversified from '../../../src/achievements/definitions/diversified.js';

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

describe('achievement: diversified', () => {
  it('unlocks at distinctSymbols = 10', async () => {
    const h = await makeAchievementHarness(diversified);
    await fireHoldings(h, 10);
    expect(await h.isUnlocked()).toBe(true);
  });

  it('unlocks at distinctSymbols > 10', async () => {
    const h = await makeAchievementHarness(diversified);
    await fireHoldings(h, 15);
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock at distinctSymbols = 9', async () => {
    const h = await makeAchievementHarness(diversified);
    await fireHoldings(h, 9);
    expect(await h.isUnlocked()).toBe(false);
  });
});
