import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import catastrophe from '../../../src/achievements/definitions/catastrophe.js';

async function fireClose(
  h: Awaited<ReturnType<typeof makeAchievementHarness>>,
  realizedPnlPct: number,
): Promise<void> {
  await h.dispatch({
    type: 'position.closed',
    gameId: h.gameId,
    gamePlayerId: h.gamePlayerId,
    symbol: 'AAPL',
    quantity: 1,
    realizedPnl: -900,
    realizedPnlPct,
    holdDurationMs: 1000,
    fullyClosed: true,
    closedAt: new Date().toISOString(),
  });
}

describe('achievement: catastrophe', () => {
  it('unlocks at exactly -90%', async () => {
    const h = await makeAchievementHarness(catastrophe);
    await fireClose(h, -0.9);
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock at -89%', async () => {
    const h = await makeAchievementHarness(catastrophe);
    await fireClose(h, -0.89);
    expect(await h.isUnlocked()).toBe(false);
  });

  it('does not unlock at bag-holder-level -50%', async () => {
    const h = await makeAchievementHarness(catastrophe);
    await fireClose(h, -0.5);
    expect(await h.isUnlocked()).toBe(false);
  });
});
