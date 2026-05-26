import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import tenBagger from '../../../src/achievements/definitions/ten-bagger.js';

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
    realizedPnl: 1000,
    realizedPnlPct,
    holdDurationMs: 1000,
    fullyClosed: true,
    closedAt: new Date().toISOString(),
  });
}

describe('achievement: ten-bagger', () => {
  it('unlocks at exactly +900% (10x return)', async () => {
    const h = await makeAchievementHarness(tenBagger);
    await fireClose(h, 9.0);
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock just below +900%', async () => {
    const h = await makeAchievementHarness(tenBagger);
    await fireClose(h, 8.99);
    expect(await h.isUnlocked()).toBe(false);
  });

  it('does not unlock at moonshot-level +50%', async () => {
    const h = await makeAchievementHarness(tenBagger);
    await fireClose(h, 0.5);
    expect(await h.isUnlocked()).toBe(false);
  });
});
