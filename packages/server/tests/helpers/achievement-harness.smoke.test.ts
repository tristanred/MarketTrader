import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from './achievement-harness.js';
import firstTrade from '../../src/achievements/definitions/first-trade.js';

describe('achievement-harness smoke', () => {
  it('unlocks first-trade on a trade.executed event', async () => {
    const h = await makeAchievementHarness(firstTrade);
    expect(await h.isUnlocked()).toBe(false);
    await h.dispatch({
      type: 'trade.executed',
      gameId: h.gameId,
      gamePlayerId: h.gamePlayerId,
      symbol: 'AAPL',
      direction: 'buy',
      quantity: 1,
      price: 100,
      tradeId: 'test-trade',
      executedAt: new Date().toISOString(),
    });
    expect(await h.isUnlocked()).toBe(true);
    // The unlock should also have been broadcast.
    expect(h.broadcasts).toHaveLength(1);
    expect(h.broadcasts[0]?.gameId).toBe(h.gameId);
  });
});
