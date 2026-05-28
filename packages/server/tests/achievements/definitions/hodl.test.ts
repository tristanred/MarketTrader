import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import { onPositionOpened } from '../../../src/services/position-high-water.js';
import hodl from '../../../src/achievements/definitions/hodl.js';

describe('achievement: hodl', () => {
  it('unlocks when a position has been held for 14 days', async () => {
    const h = await makeAchievementHarness(hodl);
    await onPositionOpened(h.db, { gamePlayerId: h.gamePlayerId, symbol: 'AAPL', openedAt: '2026-05-13T00:00:00.000Z', currentPrice: 100, quantity: 1, avgCostBasis: 100 });
    await h.dispatch({
      type: 'snapshot.recorded',
      gameId: h.gameId,
      gamePlayerId: h.gamePlayerId,
      totalValue: 100,
      rank: 1,
      totalPlayers: 1,
      capturedAt: '2026-05-27T00:00:00.000Z',
    });
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock when the position has only been held for 13 days', async () => {
    const h = await makeAchievementHarness(hodl);
    await onPositionOpened(h.db, { gamePlayerId: h.gamePlayerId, symbol: 'AAPL', openedAt: '2026-05-13T00:00:00.000Z', currentPrice: 100, quantity: 1, avgCostBasis: 100 });
    await h.dispatch({
      type: 'snapshot.recorded',
      gameId: h.gameId,
      gamePlayerId: h.gamePlayerId,
      totalValue: 100,
      rank: 1,
      totalPlayers: 1,
      capturedAt: '2026-05-26T00:00:00.000Z',
    });
    expect(await h.isUnlocked()).toBe(false);
  });
});
