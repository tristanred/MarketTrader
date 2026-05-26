import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import freeFall from '../../../src/achievements/definitions/free-fall.js';
import * as schema from '../../../src/db/schema.sqlite.js';

async function setPrevRank(
  h: Awaited<ReturnType<typeof makeAchievementHarness>>,
  rank: number | null,
): Promise<void> {
  await h.db
    .insert(schema.gamePlayerStats)
    .values({ gamePlayerId: h.gamePlayerId, previousDayRank: rank })
    .onConflictDoUpdate({
      target: schema.gamePlayerStats.gamePlayerId,
      set: { previousDayRank: rank },
    });
}

async function fireSnapshot(
  h: Awaited<ReturnType<typeof makeAchievementHarness>>,
  rank: number,
): Promise<void> {
  await h.dispatch({
    type: 'snapshot.recorded',
    gameId: h.gameId,
    gamePlayerId: h.gamePlayerId,
    totalValue: 10000,
    rank,
    totalPlayers: 5,
    capturedAt: new Date().toISOString(),
  });
}

describe('achievement: free-fall', () => {
  it('unlocks when dropping exactly 3 ranks', async () => {
    const h = await makeAchievementHarness(freeFall);
    await setPrevRank(h, 1);
    await fireSnapshot(h, 4);
    expect(await h.isUnlocked()).toBe(true);
  });

  it('unlocks when dropping more than 3 ranks', async () => {
    const h = await makeAchievementHarness(freeFall);
    await setPrevRank(h, 1);
    await fireSnapshot(h, 5);
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock when dropping fewer than 3 ranks', async () => {
    const h = await makeAchievementHarness(freeFall);
    await setPrevRank(h, 2);
    await fireSnapshot(h, 4);
    expect(await h.isUnlocked()).toBe(false);
  });

  it('does not unlock when previousDayRank is null', async () => {
    const h = await makeAchievementHarness(freeFall);
    await setPrevRank(h, null);
    await fireSnapshot(h, 5);
    expect(await h.isUnlocked()).toBe(false);
  });
});
