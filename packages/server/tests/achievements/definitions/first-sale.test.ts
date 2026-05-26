import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import firstSale from '../../../src/achievements/definitions/first-sale.js';

async function fireTrade(
  h: Awaited<ReturnType<typeof makeAchievementHarness>>,
  direction: 'buy' | 'sell',
): Promise<void> {
  await h.dispatch({
    type: 'trade.executed',
    gameId: h.gameId,
    gamePlayerId: h.gamePlayerId,
    symbol: 'AAPL',
    direction,
    quantity: 1,
    price: 100,
    tradeId: `t-${Math.random()}`,
    executedAt: new Date().toISOString(),
  });
}

describe('achievement: first-sale', () => {
  it('unlocks on first sell', async () => {
    const h = await makeAchievementHarness(firstSale);
    await fireTrade(h, 'sell');
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock on buy', async () => {
    const h = await makeAchievementHarness(firstSale);
    await fireTrade(h, 'buy');
    expect(await h.isUnlocked()).toBe(false);
  });

  it('unlocks on sell that follows a buy', async () => {
    const h = await makeAchievementHarness(firstSale);
    await fireTrade(h, 'buy');
    expect(await h.isUnlocked()).toBe(false);
    await fireTrade(h, 'sell');
    expect(await h.isUnlocked()).toBe(true);
  });
});
