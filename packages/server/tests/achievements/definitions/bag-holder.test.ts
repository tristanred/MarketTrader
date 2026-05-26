import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import bagHolder from '../../../src/achievements/definitions/bag-holder.js';

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
    realizedPnl: -100,
    realizedPnlPct,
    holdDurationMs: 1000,
    fullyClosed: true,
    closedAt: new Date().toISOString(),
  });
}

describe('achievement: bag-holder', () => {
  it('unlocks at exactly -50%', async () => {
    const h = await makeAchievementHarness(bagHolder);
    await fireClose(h, -0.5);
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock at -49%', async () => {
    const h = await makeAchievementHarness(bagHolder);
    await fireClose(h, -0.49);
    expect(await h.isUnlocked()).toBe(false);
  });

  it('does not unlock on a gain', async () => {
    const h = await makeAchievementHarness(bagHolder);
    await fireClose(h, 0.2);
    expect(await h.isUnlocked()).toBe(false);
  });
});
