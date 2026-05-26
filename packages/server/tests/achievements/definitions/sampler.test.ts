import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import sampler from '../../../src/achievements/definitions/sampler.js';
import * as schema from '../../../src/db/schema.sqlite.js';

async function setDistinct(
  h: Awaited<ReturnType<typeof makeAchievementHarness>>,
  n: number,
): Promise<void> {
  await h.db
    .insert(schema.gamePlayerStats)
    .values({ gamePlayerId: h.gamePlayerId, distinctSymbolsTradedEver: n })
    .onConflictDoUpdate({
      target: schema.gamePlayerStats.gamePlayerId,
      set: { distinctSymbolsTradedEver: n },
    });
}

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

describe('achievement: sampler', () => {
  it('unlocks once distinctSymbolsTradedEver reaches 5', async () => {
    const h = await makeAchievementHarness(sampler);
    await setDistinct(h, 5);
    await fireTrade(h);
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock at distinctSymbolsTradedEver = 4', async () => {
    const h = await makeAchievementHarness(sampler);
    await setDistinct(h, 4);
    await fireTrade(h);
    expect(await h.isUnlocked()).toBe(false);
    expect(await h.progress()).toBe(4);
  });
});
