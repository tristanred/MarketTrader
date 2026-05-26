import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import firstBlood from '../../../src/achievements/definitions/first-blood.js';

async function fireClose(
  h: Awaited<ReturnType<typeof makeAchievementHarness>>,
  realizedPnl: number,
  realizedPnlPct: number,
): Promise<void> {
  await h.dispatch({
    type: 'position.closed',
    gameId: h.gameId,
    gamePlayerId: h.gamePlayerId,
    symbol: 'AAPL',
    quantity: 1,
    realizedPnl,
    realizedPnlPct,
    holdDurationMs: 1000,
    fullyClosed: true,
    closedAt: new Date().toISOString(),
  });
}

describe('achievement: first-blood', () => {
  it('unlocks on a profitable close', async () => {
    const h = await makeAchievementHarness(firstBlood);
    await fireClose(h, 50, 0.5);
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock on a losing close', async () => {
    const h = await makeAchievementHarness(firstBlood);
    await fireClose(h, -10, -0.1);
    expect(await h.isUnlocked()).toBe(false);
  });

  it('does not unlock on a flat (zero P&L) close', async () => {
    const h = await makeAchievementHarness(firstBlood);
    await fireClose(h, 0, 0);
    expect(await h.isUnlocked()).toBe(false);
  });
});
