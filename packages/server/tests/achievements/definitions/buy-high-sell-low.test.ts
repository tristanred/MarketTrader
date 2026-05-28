import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import buyHighSellLow from '../../../src/achievements/definitions/buy-high-sell-low.js';

async function fireClose(
  h: Awaited<ReturnType<typeof makeAchievementHarness>>,
  realizedPnlPct: number,
): Promise<void> {
  await h.dispatch({
    type: 'position.closed',
    gameId: h.gameId,
    gamePlayerId: h.gamePlayerId,
    symbol: 'AAPL',
    quantity: 1,
    realizedPnl: -300,
    realizedPnlPct,
    holdDurationMs: 1000,
    fullyClosed: true,
    closedAt: new Date().toISOString(),
  });
}

describe('achievement: buy-high-sell-low', () => {
  it('unlocks at -30% loss', async () => {
    const h = await makeAchievementHarness(buyHighSellLow);
    await fireClose(h, -0.30);
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock at -20% loss', async () => {
    const h = await makeAchievementHarness(buyHighSellLow);
    await fireClose(h, -0.20);
    expect(await h.isUnlocked()).toBe(false);
  });
});
