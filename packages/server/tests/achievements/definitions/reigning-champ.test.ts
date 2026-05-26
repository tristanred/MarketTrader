import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import reigningChamp from '../../../src/achievements/definitions/reigning-champ.js';
import * as schema from '../../../src/db/schema.sqlite.js';

async function setConsec(
  h: Awaited<ReturnType<typeof makeAchievementHarness>>,
  n: number,
): Promise<void> {
  await h.db
    .insert(schema.gamePlayerStats)
    .values({ gamePlayerId: h.gamePlayerId, consecutiveDaysAtRankOne: n })
    .onConflictDoUpdate({
      target: schema.gamePlayerStats.gamePlayerId,
      set: { consecutiveDaysAtRankOne: n },
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
    rank: 1,
    totalPlayers: 5,
    capturedAt: new Date().toISOString(),
  });
}

describe('achievement: reigning-champ', () => {
  it('unlocks at consecutiveDaysAtRankOne = 3', async () => {
    const h = await makeAchievementHarness(reigningChamp);
    await setConsec(h, 3);
    await fireSnapshot(h);
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock at consecutiveDaysAtRankOne = 2', async () => {
    const h = await makeAchievementHarness(reigningChamp);
    await setConsec(h, 2);
    await fireSnapshot(h);
    expect(await h.isUnlocked()).toBe(false);
    expect(await h.progress()).toBe(2);
  });
});
