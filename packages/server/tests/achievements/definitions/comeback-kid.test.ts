import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import comebackKid from '../../../src/achievements/definitions/comeback-kid.js';
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

describe('achievement: comeback-kid', () => {
  it('unlocks when climbing exactly 3 ranks', async () => {
    const h = await makeAchievementHarness(comebackKid);
    await setPrevRank(h, 5);
    await fireSnapshot(h, 2);
    expect(await h.isUnlocked()).toBe(true);
  });

  it('unlocks when climbing more than 3 ranks', async () => {
    const h = await makeAchievementHarness(comebackKid);
    await setPrevRank(h, 5);
    await fireSnapshot(h, 1);
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock when climbing fewer than 3 ranks', async () => {
    const h = await makeAchievementHarness(comebackKid);
    await setPrevRank(h, 4);
    await fireSnapshot(h, 2);
    expect(await h.isUnlocked()).toBe(false);
  });

  it('does not unlock when previousDayRank is null (first day)', async () => {
    const h = await makeAchievementHarness(comebackKid);
    await setPrevRank(h, null);
    await fireSnapshot(h, 1);
    expect(await h.isUnlocked()).toBe(false);
  });
});
