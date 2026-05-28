import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import { applyTradeStats } from '../../../src/services/game-player-stats.js';
import sirThisIsAWendys from '../../../src/achievements/definitions/sir-this-is-a-wendys.js';

async function fireTrade(
  h: Awaited<ReturnType<typeof makeAchievementHarness>>,
  executedAt: string,
): Promise<void> {
  // The achievement harness's dispatch only emits the bus event — it does not
  // run the trade-stats rollup. We invoke applyTradeStats directly so the
  // gamePlayerStats.tradesToday counter is populated before the achievement
  // handler reads it.
  await applyTradeStats(h.db, {
    gamePlayerId: h.gamePlayerId,
    direction: 'buy',
    symbol: 'AAPL',
    quantity: 1,
    price: 100,
    executedAt,
  });
  await h.dispatch({
    type: 'trade.executed',
    gameId: h.gameId,
    gamePlayerId: h.gamePlayerId,
    symbol: 'AAPL',
    direction: 'buy',
    quantity: 1,
    price: 100,
    tradeId: `t-${Math.random()}`,
    executedAt,
  });
}

describe('achievement: sir-this-is-a-wendys', () => {
  it('unlocks at 20 trades in the same UTC day', async () => {
    const h = await makeAchievementHarness(sirThisIsAWendys);
    for (let i = 0; i < 20; i++) {
      await fireTrade(h, '2026-05-27T12:00:00.000Z');
    }
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock at 19 trades', async () => {
    const h = await makeAchievementHarness(sirThisIsAWendys);
    for (let i = 0; i < 19; i++) {
      await fireTrade(h, '2026-05-27T12:00:00.000Z');
    }
    expect(await h.isUnlocked()).toBe(false);
  });

  it('does not unlock when 20 trades are split across two UTC days', async () => {
    const h = await makeAchievementHarness(sirThisIsAWendys);
    for (let i = 0; i < 15; i++) {
      await fireTrade(h, '2026-05-27T12:00:00.000Z');
    }
    for (let i = 0; i < 15; i++) {
      await fireTrade(h, '2026-05-28T12:00:00.000Z');
    }
    expect(await h.isUnlocked()).toBe(false);
  });
});
