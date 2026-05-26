import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import cashIsKing from '../../../src/achievements/definitions/cash-is-king.js';
import * as schema from '../../../src/db/schema.sqlite.js';

async function setDistinctEver(
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

async function fireHoldings(
  h: Awaited<ReturnType<typeof makeAchievementHarness>>,
  distinctSymbols: number,
): Promise<void> {
  await h.dispatch({
    type: 'holdings.changed',
    gameId: h.gameId,
    gamePlayerId: h.gamePlayerId,
    distinctSymbols,
    topConcentrationRatio: 0,
    cashRatio: distinctSymbols === 0 ? 1 : 0.5,
    changedAt: new Date().toISOString(),
  });
}

describe('achievement: cash-is-king', () => {
  it('unlocks when going to 0 distinct after ≥5 symbols traded ever', async () => {
    const h = await makeAchievementHarness(cashIsKing);
    await setDistinctEver(h, 5);
    await fireHoldings(h, 0);
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock when distinctSymbols > 0', async () => {
    const h = await makeAchievementHarness(cashIsKing);
    await setDistinctEver(h, 5);
    await fireHoldings(h, 1);
    expect(await h.isUnlocked()).toBe(false);
  });

  it('does not unlock when player has traded fewer than 5 distinct symbols', async () => {
    const h = await makeAchievementHarness(cashIsKing);
    await setDistinctEver(h, 4);
    await fireHoldings(h, 0);
    expect(await h.isUnlocked()).toBe(false);
  });

  it('does not unlock when stats row is absent', async () => {
    const h = await makeAchievementHarness(cashIsKing);
    await fireHoldings(h, 0);
    expect(await h.isUnlocked()).toBe(false);
  });
});
