import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import phoenix from '../../../src/achievements/definitions/phoenix.js';
import * as schema from '../../../src/db/schema.sqlite.js';

async function setTrough(
  h: Awaited<ReturnType<typeof makeAchievementHarness>>,
  trough: number | null,
): Promise<void> {
  await h.db
    .insert(schema.gamePlayerStats)
    .values({ gamePlayerId: h.gamePlayerId, troughPortfolioValue: trough })
    .onConflictDoUpdate({
      target: schema.gamePlayerStats.gamePlayerId,
      set: { troughPortfolioValue: trough },
    });
}

async function fireSnapshot(
  h: Awaited<ReturnType<typeof makeAchievementHarness>>,
  totalValue: number,
): Promise<void> {
  await h.dispatch({
    type: 'snapshot.recorded',
    gameId: h.gameId,
    gamePlayerId: h.gamePlayerId,
    totalValue,
    rank: 1,
    totalPlayers: 1,
    capturedAt: new Date().toISOString(),
  });
}

describe('achievement: phoenix', () => {
  it('unlocks when trough ≤75% and snapshot ≥ starting balance', async () => {
    const h = await makeAchievementHarness(phoenix);
    await setTrough(h, 7000); // 70% of 10000
    await fireSnapshot(h, 10500);
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock when recovery falls short of starting balance', async () => {
    const h = await makeAchievementHarness(phoenix);
    await setTrough(h, 7000);
    await fireSnapshot(h, 9500);
    expect(await h.isUnlocked()).toBe(false);
  });

  it('does not unlock when no trough has been recorded', async () => {
    const h = await makeAchievementHarness(phoenix);
    await fireSnapshot(h, 15000);
    expect(await h.isUnlocked()).toBe(false);
  });

  it('does not unlock when trough never breached 75%', async () => {
    const h = await makeAchievementHarness(phoenix);
    await setTrough(h, 8000); // 80% of 10000 — above the 75% threshold
    await fireSnapshot(h, 12000);
    expect(await h.isUnlocked()).toBe(false);
  });
});
