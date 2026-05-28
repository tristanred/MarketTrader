import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import { applyPositionCloseStats } from '../../../src/services/game-player-stats.js';
import taxLossHarvester from '../../../src/achievements/definitions/tax-loss-harvester.js';

async function fireClose(
  h: Awaited<ReturnType<typeof makeAchievementHarness>>,
  realizedPnl: number,
  closedAt: string,
): Promise<void> {
  await applyPositionCloseStats(h.db, {
    gamePlayerId: h.gamePlayerId,
    realizedPnl,
    realizedPnlPct: realizedPnl < 0 ? -0.5 : 0.5,
    holdDurationMs: 60_000,
    closedAt,
  });
  await h.dispatch({
    type: 'position.closed',
    gameId: h.gameId,
    gamePlayerId: h.gamePlayerId,
    symbol: 'AAPL',
    quantity: 1,
    realizedPnl,
    realizedPnlPct: realizedPnl < 0 ? -0.5 : 0.5,
    holdDurationMs: 60_000,
    fullyClosed: true,
    closedAt,
  });
}

describe('achievement: tax-loss-harvester', () => {
  it('unlocks at 3 losing closes in the same UTC day', async () => {
    const h = await makeAchievementHarness(taxLossHarvester);
    await fireClose(h, -10, '2026-05-27T01:00:00.000Z');
    await fireClose(h, -10, '2026-05-27T02:00:00.000Z');
    await fireClose(h, -10, '2026-05-27T03:00:00.000Z');
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not count winning closes', async () => {
    const h = await makeAchievementHarness(taxLossHarvester);
    await fireClose(h, -10, '2026-05-27T01:00:00.000Z');
    await fireClose(h, 10, '2026-05-27T02:00:00.000Z');
    await fireClose(h, -10, '2026-05-27T03:00:00.000Z');
    expect(await h.isUnlocked()).toBe(false);
  });

  it('does not unlock when 3 losses span two UTC days', async () => {
    const h = await makeAchievementHarness(taxLossHarvester);
    await fireClose(h, -10, '2026-05-27T22:00:00.000Z');
    await fireClose(h, -10, '2026-05-28T01:00:00.000Z');
    await fireClose(h, -10, '2026-05-28T02:00:00.000Z');
    expect(await h.isUnlocked()).toBe(false);
  });
});
