import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import pennyStockEnjoyer from '../../../src/achievements/definitions/penny-stock-enjoyer.js';

async function fireTrade(
  h: Awaited<ReturnType<typeof makeAchievementHarness>>,
  direction: 'buy' | 'sell',
  price: number,
): Promise<void> {
  await h.dispatch({
    type: 'trade.executed',
    gameId: h.gameId,
    gamePlayerId: h.gamePlayerId,
    symbol: 'AAPL',
    direction,
    quantity: 1,
    price,
    tradeId: `t-${Math.random()}`,
    executedAt: new Date().toISOString(),
  });
}

describe('achievement: penny-stock-enjoyer', () => {
  it('unlocks when buying a stock at $4', async () => {
    const h = await makeAchievementHarness(pennyStockEnjoyer);
    await fireTrade(h, 'buy', 4);
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock when buying a stock at exactly $5 (strict <)', async () => {
    const h = await makeAchievementHarness(pennyStockEnjoyer);
    await fireTrade(h, 'buy', 5);
    expect(await h.isUnlocked()).toBe(false);
  });
});
