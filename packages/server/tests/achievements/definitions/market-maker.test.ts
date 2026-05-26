import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import marketMaker from '../../../src/achievements/definitions/market-maker.js';

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

describe('achievement: market-maker', () => {
  it('unlocks after 50 trades', async () => {
    const h = await makeAchievementHarness(marketMaker);
    for (let i = 0; i < 50; i++) {
      await fireTrade(h);
    }
    expect(await h.isUnlocked()).toBe(true);
    expect(await h.progress()).toBe(50);
  });

  it('does not unlock at 49 trades', async () => {
    const h = await makeAchievementHarness(marketMaker);
    for (let i = 0; i < 49; i++) {
      await fireTrade(h);
    }
    expect(await h.isUnlocked()).toBe(false);
    expect(await h.progress()).toBe(49);
  });
});
