import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import oneShareWonder from '../../../src/achievements/definitions/one-share-wonder.js';

async function fireTrade(
  h: Awaited<ReturnType<typeof makeAchievementHarness>>,
  direction: 'buy' | 'sell',
  quantity: number,
  price: number,
): Promise<void> {
  await h.dispatch({
    type: 'trade.executed',
    gameId: h.gameId,
    gamePlayerId: h.gamePlayerId,
    symbol: 'AAPL',
    direction,
    quantity,
    price,
    tradeId: `t-${Math.random()}`,
    executedAt: new Date().toISOString(),
  });
}

describe('achievement: one-share-wonder', () => {
  it('unlocks when buying exactly 1 share at $501', async () => {
    const h = await makeAchievementHarness(oneShareWonder);
    await fireTrade(h, 'buy', 1, 501);
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock when buying exactly 1 share at exactly $500 (strict >)', async () => {
    const h = await makeAchievementHarness(oneShareWonder);
    await fireTrade(h, 'buy', 1, 500);
    expect(await h.isUnlocked()).toBe(false);
  });

  it('does not unlock when buying 2 shares at $600', async () => {
    const h = await makeAchievementHarness(oneShareWonder);
    await fireTrade(h, 'buy', 2, 600);
    expect(await h.isUnlocked()).toBe(false);
  });
});
