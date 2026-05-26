import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import concentratedBet from '../../../src/achievements/definitions/concentrated-bet.js';
import * as schema from '../../../src/db/schema.sqlite.js';

async function setCashAfter(
  h: Awaited<ReturnType<typeof makeAchievementHarness>>,
  cash: number,
): Promise<void> {
  await h.db
    .update(schema.gamePlayers)
    .set({ cashBalance: cash })
    .where(eq(schema.gamePlayers.id, h.gamePlayerId));
}

async function fireBuy(
  h: Awaited<ReturnType<typeof makeAchievementHarness>>,
  quantity: number,
  price: number,
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

describe('achievement: concentrated-bet', () => {
  it('unlocks when buy consumes ≥50% of pre-trade cash', async () => {
    // cashAfter = 1000, cost = 1500 → cashBefore = 2500, ratio = 0.6.
    const h = await makeAchievementHarness(concentratedBet);
    await setCashAfter(h, 1000);
    await fireBuy(h, 15, 100);
    expect(await h.isUnlocked()).toBe(true);
  });

  it('unlocks at exactly 50% of pre-trade cash', async () => {
    // cashAfter = 1000, cost = 1000 → cashBefore = 2000, ratio = 0.5.
    const h = await makeAchievementHarness(concentratedBet);
    await setCashAfter(h, 1000);
    await fireBuy(h, 10, 100);
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock when buy is <50% of pre-trade cash', async () => {
    // cashAfter = 5000, cost = 1500 → cashBefore = 6500, ratio ≈ 0.23.
    const h = await makeAchievementHarness(concentratedBet);
    await setCashAfter(h, 5000);
    await fireBuy(h, 15, 100);
    expect(await h.isUnlocked()).toBe(false);
  });

  it('does not unlock on a sell trade', async () => {
    const h = await makeAchievementHarness(concentratedBet);
    await setCashAfter(h, 1000);
    await h.dispatch({
      type: 'trade.executed',
      gameId: h.gameId,
      gamePlayerId: h.gamePlayerId,
      symbol: 'AAPL',
      direction: 'sell',
      quantity: 15,
      price: 100,
      tradeId: `t-${Math.random()}`,
      executedAt: new Date().toISOString(),
    });
    expect(await h.isUnlocked()).toBe(false);
  });
});
