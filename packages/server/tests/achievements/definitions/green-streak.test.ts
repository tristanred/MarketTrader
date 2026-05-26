import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import greenStreak from '../../../src/achievements/definitions/green-streak.js';
import * as schema from '../../../src/db/schema.sqlite.js';

async function setWins(
  h: Awaited<ReturnType<typeof makeAchievementHarness>>,
  n: number,
): Promise<void> {
  await h.db
    .insert(schema.gamePlayerStats)
    .values({ gamePlayerId: h.gamePlayerId, consecutiveWins: n })
    .onConflictDoUpdate({
      target: schema.gamePlayerStats.gamePlayerId,
      set: { consecutiveWins: n },
    });
}

async function fireClose(h: Awaited<ReturnType<typeof makeAchievementHarness>>): Promise<void> {
  await h.dispatch({
    type: 'position.closed',
    gameId: h.gameId,
    gamePlayerId: h.gamePlayerId,
    symbol: 'AAPL',
    quantity: 1,
    realizedPnl: 10,
    realizedPnlPct: 0.1,
    holdDurationMs: 1000,
    fullyClosed: true,
    closedAt: new Date().toISOString(),
  });
}

describe('achievement: green-streak', () => {
  it('unlocks when consecutiveWins reaches 5', async () => {
    const h = await makeAchievementHarness(greenStreak);
    await setWins(h, 5);
    await fireClose(h);
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock at consecutiveWins = 4 and reflects progress', async () => {
    const h = await makeAchievementHarness(greenStreak);
    await setWins(h, 4);
    await fireClose(h);
    expect(await h.isUnlocked()).toBe(false);
    expect(await h.progress()).toBe(4);
  });
});
