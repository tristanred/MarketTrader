import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import dollarMenu from '../../../src/achievements/definitions/dollar-menu.js';

async function fireTrade(
  h: Awaited<ReturnType<typeof makeAchievementHarness>>,
  price: number,
  quantity: number,
): Promise<void> {
  await h.dispatch({
    type: 'trade.executed',
    gameId: h.gameId,
    gamePlayerId: h.gamePlayerId,
    symbol: 'AAPL',
    direction: 'buy',
    quantity,
    price,
    tradeId: `t-${Math.random()}`,
    executedAt: new Date().toISOString(),
  });
}

describe('achievement: dollar-menu', () => {
  it('unlocks when trade value is under $10', async () => {
    const h = await makeAchievementHarness(dollarMenu);
    await fireTrade(h, 2, 4); // 2 * 4 = 8 < 10
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock when trade value equals $10', async () => {
    const h = await makeAchievementHarness(dollarMenu);
    await fireTrade(h, 5, 2); // 5 * 2 = 10, NOT < 10
    expect(await h.isUnlocked()).toBe(false);
  });
});
