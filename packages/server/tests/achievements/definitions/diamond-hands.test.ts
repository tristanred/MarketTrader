import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import diamondHands from '../../../src/achievements/definitions/diamond-hands.js';

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

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

describe('achievement: diamond-hands', () => {
  it('unlocks when a position is closed after holding for 7+ days', async () => {
    const h = await makeAchievementHarness(diamondHands);
    await fireClose(h, SEVEN_DAYS);
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock for holds shorter than 7 days', async () => {
    const h = await makeAchievementHarness(diamondHands);
    await fireClose(h, SEVEN_DAYS - 1);
    expect(await h.isUnlocked()).toBe(false);
  });
});
