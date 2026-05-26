import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import aboveAverage from '../../../src/achievements/definitions/above-average.js';
import * as schema from '../../../src/db/schema.sqlite.js';

async function setConsec(
  h: Awaited<ReturnType<typeof makeAchievementHarness>>,
  n: number,
): Promise<void> {
  await h.db
    .insert(schema.gamePlayerStats)
    .values({ gamePlayerId: h.gamePlayerId, consecutiveDaysAtOrAboveMedian: n })
    .onConflictDoUpdate({
      target: schema.gamePlayerStats.gamePlayerId,
      set: { consecutiveDaysAtOrAboveMedian: n },
    });
}

async function fireSnapshot(
  h: Awaited<ReturnType<typeof makeAchievementHarness>>,
): Promise<void> {
  await h.dispatch({
    type: 'snapshot.recorded',
    gameId: h.gameId,
    gamePlayerId: h.gamePlayerId,
    totalValue: 10000,
    rank: 2,
    totalPlayers: 5,
    capturedAt: new Date().toISOString(),
  });
}

describe('achievement: above-average', () => {
  it('unlocks at consecutiveDaysAtOrAboveMedian = 7', async () => {
    const h = await makeAchievementHarness(aboveAverage);
    await setConsec(h, 7);
    await fireSnapshot(h);
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock at consecutiveDaysAtOrAboveMedian = 6', async () => {
    const h = await makeAchievementHarness(aboveAverage);
    await setConsec(h, 6);
    await fireSnapshot(h);
    expect(await h.isUnlocked()).toBe(false);
    expect(await h.progress()).toBe(6);
  });
});
