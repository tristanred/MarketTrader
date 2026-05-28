import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import { onPositionOpened, updateMarks } from '../../../src/services/position-high-water.js';
import stonks from '../../../src/achievements/definitions/stonks.js';

describe('achievement: stonks', () => {
  it('unlocks when a held position has been up 10% or more', async () => {
    const h = await makeAchievementHarness(stonks);
    await onPositionOpened(h.db, { gamePlayerId: h.gamePlayerId, symbol: 'AAPL', openedAt: '2026-05-27T00:00:00.000Z', currentPrice: 100, quantity: 1, avgCostBasis: 100 });
    await updateMarks(h.db, h.gamePlayerId, [{ symbol: 'AAPL', currentPrice: 112, quantity: 1, avgCostBasis: 100 }]);
    await h.dispatch({
      type: 'snapshot.recorded',
      gameId: h.gameId,
      gamePlayerId: h.gamePlayerId,
      totalValue: 112,
      rank: 1,
      totalPlayers: 1,
      capturedAt: '2026-05-27T00:01:00.000Z',
    });
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock when the position has not risen 10%', async () => {
    const h = await makeAchievementHarness(stonks);
    await onPositionOpened(h.db, { gamePlayerId: h.gamePlayerId, symbol: 'AAPL', openedAt: '2026-05-27T00:00:00.000Z', currentPrice: 100, quantity: 1, avgCostBasis: 100 });
    await updateMarks(h.db, h.gamePlayerId, [{ symbol: 'AAPL', currentPrice: 105, quantity: 1, avgCostBasis: 100 }]);
    await h.dispatch({
      type: 'snapshot.recorded',
      gameId: h.gameId,
      gamePlayerId: h.gamePlayerId,
      totalValue: 105,
      rank: 1,
      totalPlayers: 1,
      capturedAt: '2026-05-27T00:01:00.000Z',
    });
    expect(await h.isUnlocked()).toBe(false);
  });
});
