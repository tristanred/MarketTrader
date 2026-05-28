import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import whale from '../../../src/achievements/definitions/whale.js';

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

describe('achievement: whale', () => {
  it('unlocks when trade equals exactly 25% of starting balance', async () => {
    const h = await makeAchievementHarness(whale, { startingBalance: 10000 });
    await fireTrade(h, 100, 25); // 100 * 25 = 2500 = 25% of 10000
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock when trade is just under 25% of starting balance', async () => {
    const h = await makeAchievementHarness(whale, { startingBalance: 10000 });
    await fireTrade(h, 100, 24); // 100 * 24 = 2400 < 25% of 10000
    expect(await h.isUnlocked()).toBe(false);
  });
});
