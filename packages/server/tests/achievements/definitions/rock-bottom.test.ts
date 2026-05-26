import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import rockBottom from '../../../src/achievements/definitions/rock-bottom.js';
import * as schema from '../../../src/db/schema.sqlite.js';

async function setConsec(
  h: Awaited<ReturnType<typeof makeAchievementHarness>>,
  n: number,
): Promise<void> {
  await h.db
    .insert(schema.gamePlayerStats)
    .values({ gamePlayerId: h.gamePlayerId, consecutiveDaysInLastPlace: n })
    .onConflictDoUpdate({
      target: schema.gamePlayerStats.gamePlayerId,
      set: { consecutiveDaysInLastPlace: n },
    });
}

async function fireSnap(
  h: Awaited<ReturnType<typeof makeAchievementHarness>>,
  totalPlayers: number,
): Promise<void> {
  await h.dispatch({
    type: 'snapshot.recorded',
    gameId: h.gameId,
    gamePlayerId: h.gamePlayerId,
    totalValue: 1,
    rank: totalPlayers,
    totalPlayers,
    capturedAt: new Date().toISOString(),
  });
}

describe('achievement: rock-bottom', () => {
  it('unlocks once consecutiveDaysInLastPlace reaches the target (3 days)', async () => {
    const h = await makeAchievementHarness(rockBottom);
    await setConsec(h, 3);
    await fireSnap(h, 4);
    expect(await h.isUnlocked()).toBe(true);
  });

  it('tracks partial progress without unlocking', async () => {
    const h = await makeAchievementHarness(rockBottom);
    await setConsec(h, 2);
    await fireSnap(h, 4);
    expect(await h.isUnlocked()).toBe(false);
    expect(await h.progress()).toBe(2);
  });

  it('ignores single-player games even when stats indicate eligibility', async () => {
    const h = await makeAchievementHarness(rockBottom);
    await setConsec(h, 3);
    await fireSnap(h, 1);
    expect(await h.isUnlocked()).toBe(false);
    expect(await h.progress()).toBe(0);
  });
});
