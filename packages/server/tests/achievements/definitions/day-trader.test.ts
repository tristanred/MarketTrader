import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import dayTrader from '../../../src/achievements/definitions/day-trader.js';

async function fireTrade(h: Awaited<ReturnType<typeof makeAchievementHarness>>): Promise<void> {
  await h.dispatch({
    type: 'trade.executed',
    gameId: h.gameId,
    gamePlayerId: h.gamePlayerId,
    symbol: 'AAPL',
    direction: 'buy',
    quantity: 1,
    price: 100,
    tradeId: `t-${Math.random()}`,
    executedAt: new Date().toISOString(),
  });
}

describe('achievement: day-trader', () => {
  it('unlocks after 25 trades', async () => {
    const h = await makeAchievementHarness(dayTrader);
    for (let i = 0; i < 25; i++) {
      await fireTrade(h);
    }
    expect(await h.isUnlocked()).toBe(true);
    expect(await h.progress()).toBe(25);
  });

  it('does not unlock at 24 trades', async () => {
    const h = await makeAchievementHarness(dayTrader);
    for (let i = 0; i < 24; i++) {
      await fireTrade(h);
    }
    expect(await h.isUnlocked()).toBe(false);
    expect(await h.progress()).toBe(24);
  });
});
