import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import fomo from '../../../src/achievements/definitions/fomo.js';
import * as schema from '../../../src/db/schema.sqlite.js';

async function insertPortfolioRow(
  h: Awaited<ReturnType<typeof makeAchievementHarness>>,
  gamePlayerId: string,
  symbol: string,
  openedAt: string,
): Promise<void> {
  await h.db.insert(schema.portfolios).values({
    gamePlayerId,
    symbol,
    quantity: 1,
    avgCostBasis: 100,
    openedAt,
  });
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
    tradeId: `t-${Math.random()}`,
    executedAt,
  });
}

describe('achievement: fomo', () => {
  it('unlocks when another player opened the same symbol in the last 5 minutes', async () => {
    const h = await makeAchievementHarness(fomo, { numPlayers: 2 });
    const now = Date.now();
    await insertPortfolioRow(
      h,
      h.players[1]!.gamePlayerId,
      'AAPL',
      new Date(now - 2 * 60 * 1000).toISOString(),
    );
    await fireBuy(h, 'AAPL', new Date(now).toISOString());
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock when the other player opened more than 5 minutes ago', async () => {
    const h = await makeAchievementHarness(fomo, { numPlayers: 2 });
    const now = Date.now();
    await insertPortfolioRow(
      h,
      h.players[1]!.gamePlayerId,
      'AAPL',
      new Date(now - 10 * 60 * 1000).toISOString(),
    );
    await fireBuy(h, 'AAPL', new Date(now).toISOString());
    expect(await h.isUnlocked()).toBe(false);
  });

  it('does not unlock when only the buying player has recently opened the symbol', async () => {
    const h = await makeAchievementHarness(fomo, { numPlayers: 2 });
    const now = Date.now();
    await insertPortfolioRow(h, h.gamePlayerId, 'AAPL', new Date(now - 60 * 1000).toISOString());
    await fireBuy(h, 'AAPL', new Date(now).toISOString());
    expect(await h.isUnlocked()).toBe(false);
  });
});
