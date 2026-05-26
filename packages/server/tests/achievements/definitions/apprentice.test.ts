import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import apprentice from '../../../src/achievements/definitions/apprentice.js';

async function fireTrade(
  h: Awaited<ReturnType<typeof makeAchievementHarness>>,
  direction: 'buy' | 'sell' = 'buy',
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

describe('achievement: apprentice', () => {
  it('unlocks after 12 trades', async () => {
    const h = await makeAchievementHarness(apprentice);
    for (let i = 0; i < 12; i++) {
      await fireTrade(h, i % 2 === 0 ? 'buy' : 'sell');
    }
    expect(await h.isUnlocked()).toBe(true);
    expect(await h.progress()).toBe(12);
  });

  it('does not unlock at 11 trades', async () => {
    const h = await makeAchievementHarness(apprentice);
    for (let i = 0; i < 11; i++) {
      await fireTrade(h);
    }
    expect(await h.isUnlocked()).toBe(false);
    expect(await h.progress()).toBe(11);
  });
});
