import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import paperHands from '../../../src/achievements/definitions/paper-hands.js';

async function fireClose(
  h: Awaited<ReturnType<typeof makeAchievementHarness>>,
  holdDurationMs: number,
): Promise<void> {
  await h.dispatch({
    type: 'position.closed',
    gameId: h.gameId,
    gamePlayerId: h.gamePlayerId,
    symbol: 'AAPL',
    quantity: 1,
    realizedPnl: 0,
    realizedPnlPct: 0,
    holdDurationMs,
    fullyClosed: true,
    closedAt: new Date().toISOString(),
  });
}

describe('achievement: paper-hands', () => {
  it('unlocks when a position is closed under 5 minutes after opening', async () => {
    const h = await makeAchievementHarness(paperHands);
    await fireClose(h, 4 * 60 * 1000);
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock at or above 5 minutes', async () => {
    const h = await makeAchievementHarness(paperHands);
    await fireClose(h, 5 * 60 * 1000);
    expect(await h.isUnlocked()).toBe(false);
  });
});
