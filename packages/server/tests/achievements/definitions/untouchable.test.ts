import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import untouchable from '../../../src/achievements/definitions/untouchable.js';
import * as schema from '../../../src/db/schema.sqlite.js';

async function setDays(
  h: Awaited<ReturnType<typeof makeAchievementHarness>>,
  n: number,
): Promise<void> {
  await h.db
    .insert(schema.gamePlayerStats)
    .values({ gamePlayerId: h.gamePlayerId, daysAtRankOne: n })
    .onConflictDoUpdate({
      target: schema.gamePlayerStats.gamePlayerId,
      set: { daysAtRankOne: n },
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

describe('achievement: untouchable', () => {
  it('unlocks at daysAtRankOne = 7', async () => {
    const h = await makeAchievementHarness(untouchable);
    await setDays(h, 7);
    await fireSnapshot(h);
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock at daysAtRankOne = 6', async () => {
    const h = await makeAchievementHarness(untouchable);
    await setDays(h, 6);
    await fireSnapshot(h);
    expect(await h.isUnlocked()).toBe(false);
    expect(await h.progress()).toBe(6);
  });
});
