import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import { onPositionOpened, updateMarks } from '../../../src/services/position-high-water.js';
import diamondPlatedHands from '../../../src/achievements/definitions/diamond-plated-hands.js';

describe('achievement: diamond-plated-hands', () => {
  it('unlocks when a position is closed green after surviving a 25% drawdown', async () => {
    const h = await makeAchievementHarness(diamondPlatedHands);
    await onPositionOpened(h.db, { gamePlayerId: h.gamePlayerId, symbol: 'AAPL', openedAt: '2026-05-20T00:00:00.000Z', currentPrice: 100, quantity: 1, avgCostBasis: 100 });
    // Push trough to -25%
    await updateMarks(h.db, h.gamePlayerId, [{ symbol: 'AAPL', currentPrice: 75, quantity: 1, avgCostBasis: 100 }]);
    await h.dispatch({
      type: 'position.closed',
      gameId: h.gameId,
      gamePlayerId: h.gamePlayerId,
      symbol: 'AAPL',
      quantity: 1,
      realizedPnl: 10,
      realizedPnlPct: 0.1,
      holdDurationMs: 7 * 24 * 60 * 60 * 1000,
      fullyClosed: true,
      closedAt: '2026-05-27T00:00:00.000Z',
    });
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock when the trough was only -10%', async () => {
    const h = await makeAchievementHarness(diamondPlatedHands);
    await onPositionOpened(h.db, { gamePlayerId: h.gamePlayerId, symbol: 'MSFT', openedAt: '2026-05-20T00:00:00.000Z', currentPrice: 100, quantity: 1, avgCostBasis: 100 });
    // Push trough to only -10%
    await updateMarks(h.db, h.gamePlayerId, [{ symbol: 'MSFT', currentPrice: 90, quantity: 1, avgCostBasis: 100 }]);
    await h.dispatch({
      type: 'position.closed',
      gameId: h.gameId,
      gamePlayerId: h.gamePlayerId,
      symbol: 'MSFT',
      quantity: 1,
      realizedPnl: 10,
      realizedPnlPct: 0.1,
      holdDurationMs: 7 * 24 * 60 * 60 * 1000,
      fullyClosed: true,
      closedAt: '2026-05-27T00:00:00.000Z',
    });
    expect(await h.isUnlocked()).toBe(false);
  });
});
