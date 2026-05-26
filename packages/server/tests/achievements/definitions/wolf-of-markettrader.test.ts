import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import wolf from '../../../src/achievements/definitions/wolf-of-markettrader.js';
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

describe('achievement: wolf-of-markettrader', () => {
  it('unlocks at exactly 100% of starting balance in realized P&L', async () => {
    const h = await makeAchievementHarness(wolf);
    await setRealizedPnl(h, 10000); // 100% of default 10000
    await fireClose(h);
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock just below 100%', async () => {
    const h = await makeAchievementHarness(wolf);
    await setRealizedPnl(h, 9999);
    await fireClose(h);
    expect(await h.isUnlocked()).toBe(false);
  });

  it('does not unlock at locked-in-tier realized P&L (25%)', async () => {
    const h = await makeAchievementHarness(wolf);
    await setRealizedPnl(h, 2500);
    await fireClose(h);
    expect(await h.isUnlocked()).toBe(false);
  });
});
