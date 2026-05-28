import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import speedrunAnyPercent from '../../../src/achievements/definitions/speedrun-any-percent.js';

async function fireSnapshot(
  h: Awaited<ReturnType<typeof makeAchievementHarness>>,
  totalValue: number,
  capturedAt: string,
): Promise<void> {
  await h.dispatch({
    type: 'snapshot.recorded',
    gameId: h.gameId,
    gamePlayerId: h.gamePlayerId,
    totalValue,
    rank: 1,
    totalPlayers: 1,
    capturedAt,
  });
}

describe('achievement: speedrun-any-percent', () => {
  it('unlocks when 2x balance reached within 7 days', async () => {
    const h = await makeAchievementHarness(speedrunAnyPercent, { startingBalance: 10000 });
    // Harness seeds startDate as 2020-01-01; snapshot at 5 days later (< 7 days)
    await fireSnapshot(h, 20000, '2020-01-06T00:00:00.000Z');
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock when 2x balance reached after 7 days', async () => {
    const h = await makeAchievementHarness(speedrunAnyPercent, { startingBalance: 10000 });
    // Snapshot at 8 days later (>= 7 days, not < SEVEN_DAYS_MS)
    await fireSnapshot(h, 20000, '2020-01-09T00:00:00.000Z');
    expect(await h.isUnlocked()).toBe(false);
  });
});
