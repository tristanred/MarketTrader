import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import sixSeven from '../../../src/achievements/definitions/six-seven.js';

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

describe('achievement: six-seven', () => {
  it('unlocks after 67 trades', async () => {
    const h = await makeAchievementHarness(sixSeven);
    for (let i = 0; i < 67; i++) {
      await fireTrade(h);
    }
    expect(await h.isUnlocked()).toBe(true);
    expect(await h.progress()).toBe(67);
  });

  it('does not unlock at 66 trades', async () => {
    const h = await makeAchievementHarness(sixSeven);
    for (let i = 0; i < 66; i++) {
      await fireTrade(h);
    }
    expect(await h.isUnlocked()).toBe(false);
    expect(await h.progress()).toBe(66);
  });
});
