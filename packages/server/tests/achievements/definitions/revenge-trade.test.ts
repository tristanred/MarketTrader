import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import revengeTrade from '../../../src/achievements/definitions/revenge-trade.js';
import * as schema from '../../../src/db/schema.sqlite.js';

async function insertSell(
  h: Awaited<ReturnType<typeof makeAchievementHarness>>,
  symbol: string,
  executedAt: string,
): Promise<string> {
  const [row] = await h.db
    .insert(schema.trades)
    .values({
      gamePlayerId: h.gamePlayerId,
      symbol,
      direction: 'sell',
      quantity: 1,
      status: 'executed',
      price: 100,
      executedAt,
    })
    .returning();
  return row!.id;
}

async function fireBuy(
  h: Awaited<ReturnType<typeof makeAchievementHarness>>,
  symbol: string,
  executedAt: string,
): Promise<void> {
  await h.dispatch({
    type: 'trade.executed',
    gameId: h.gameId,
    gamePlayerId: h.gamePlayerId,
    symbol,
    direction: 'buy',
    quantity: 1,
    price: 100,
    tradeId: `buy-${Math.random()}`,
    executedAt,
  });
}

describe('achievement: revenge-trade', () => {
  it('unlocks when buying within 1 hour of selling the same symbol', async () => {
    const h = await makeAchievementHarness(revengeTrade);
    const now = Date.now();
    const sellAt = new Date(now - 30 * 60 * 1000).toISOString(); // 30 min ago
    await insertSell(h, 'AAPL', sellAt);
    await fireBuy(h, 'AAPL', new Date(now).toISOString());
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock when the prior sell is older than 1 hour', async () => {
    const h = await makeAchievementHarness(revengeTrade);
    const now = Date.now();
    const sellAt = new Date(now - 2 * 60 * 60 * 1000).toISOString(); // 2h ago
    await insertSell(h, 'AAPL', sellAt);
    await fireBuy(h, 'AAPL', new Date(now).toISOString());
    expect(await h.isUnlocked()).toBe(false);
  });

  it('does not unlock on sell events', async () => {
    const h = await makeAchievementHarness(revengeTrade);
    await h.dispatch({
      type: 'trade.executed',
      gameId: h.gameId,
      gamePlayerId: h.gamePlayerId,
      symbol: 'AAPL',
      direction: 'sell',
      quantity: 1,
      price: 100,
      tradeId: 'x',
      executedAt: new Date().toISOString(),
    });
    expect(await h.isUnlocked()).toBe(false);
  });
});
