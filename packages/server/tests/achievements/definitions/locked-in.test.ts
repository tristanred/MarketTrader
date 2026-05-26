import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import lockedIn from '../../../src/achievements/definitions/locked-in.js';
import * as schema from '../../../src/db/schema.sqlite.js';

async function setRealizedPnl(
  h: Awaited<ReturnType<typeof makeAchievementHarness>>,
  n: number,
): Promise<void> {
  await h.db
    .insert(schema.gamePlayerStats)
    .values({ gamePlayerId: h.gamePlayerId, realizedPnl: n })
    .onConflictDoUpdate({
      target: schema.gamePlayerStats.gamePlayerId,
      set: { realizedPnl: n },
    });
}

async function fireClose(h: Awaited<ReturnType<typeof makeAchievementHarness>>): Promise<void> {
  await h.dispatch({
    type: 'position.closed',
    gameId: h.gameId,
    gamePlayerId: h.gamePlayerId,
    symbol: 'AAPL',
    quantity: 1,
    realizedPnl: 0,
    realizedPnlPct: 0,
    holdDurationMs: 1000,
    fullyClosed: true,
    closedAt: new Date().toISOString(),
  });
}

describe('achievement: locked-in', () => {
  it('unlocks at exactly 25% of starting balance', async () => {
    const h = await makeAchievementHarness(lockedIn);
    await setRealizedPnl(h, 2500); // 25% of default 10000
    await fireClose(h);
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock just below 25% of starting balance', async () => {
    const h = await makeAchievementHarness(lockedIn);
    await setRealizedPnl(h, 2499);
    await fireClose(h);
    expect(await h.isUnlocked()).toBe(false);
  });

  it('does not unlock when no stats row exists', async () => {
    const h = await makeAchievementHarness(lockedIn);
    await fireClose(h);
    expect(await h.isUnlocked()).toBe(false);
  });
});
