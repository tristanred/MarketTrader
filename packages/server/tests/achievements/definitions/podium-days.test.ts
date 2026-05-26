import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import podiumDays from '../../../src/achievements/definitions/podium-days.js';
import * as schema from '../../../src/db/schema.sqlite.js';

async function setDays(
  h: Awaited<ReturnType<typeof makeAchievementHarness>>,
  n: number,
): Promise<void> {
  await h.db
    .insert(schema.gamePlayerStats)
    .values({ gamePlayerId: h.gamePlayerId, daysInTopThree: n })
    .onConflictDoUpdate({
      target: schema.gamePlayerStats.gamePlayerId,
      set: { daysInTopThree: n },
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

describe('achievement: podium-days', () => {
  it('unlocks at daysInTopThree = 5', async () => {
    const h = await makeAchievementHarness(podiumDays);
    await setDays(h, 5);
    await fireSnapshot(h);
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock at daysInTopThree = 4', async () => {
    const h = await makeAchievementHarness(podiumDays);
    await setDays(h, 4);
    await fireSnapshot(h);
    expect(await h.isUnlocked()).toBe(false);
    expect(await h.progress()).toBe(4);
  });
});
