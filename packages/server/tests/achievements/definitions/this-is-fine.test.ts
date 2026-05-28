import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import { onPositionOpened, updateMarks } from '../../../src/services/position-high-water.js';
import thisIsFine from '../../../src/achievements/definitions/this-is-fine.js';

describe('achievement: this-is-fine', () => {
  it('unlocks when a position is down 30%+ and has been held for 3+ days', async () => {
    const h = await makeAchievementHarness(thisIsFine);
    await onPositionOpened(h.db, { gamePlayerId: h.gamePlayerId, symbol: 'AAPL', openedAt: '2026-05-24T00:00:00.000Z', currentPrice: 100, quantity: 1, avgCostBasis: 100 });
    await updateMarks(h.db, h.gamePlayerId, [{ symbol: 'AAPL', currentPrice: 65, quantity: 1, avgCostBasis: 100 }]);
    await h.dispatch({
      type: 'snapshot.recorded',
      gameId: h.gameId,
      gamePlayerId: h.gamePlayerId,
      totalValue: 65,
      rank: 1,
      totalPlayers: 1,
      capturedAt: '2026-05-28T00:00:00.000Z',
    });
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock when the position has only been held for 1 day', async () => {
    const h = await makeAchievementHarness(thisIsFine);
    await onPositionOpened(h.db, { gamePlayerId: h.gamePlayerId, symbol: 'AAPL', openedAt: '2026-05-24T00:00:00.000Z', currentPrice: 100, quantity: 1, avgCostBasis: 100 });
    await updateMarks(h.db, h.gamePlayerId, [{ symbol: 'AAPL', currentPrice: 65, quantity: 1, avgCostBasis: 100 }]);
    await h.dispatch({
      type: 'snapshot.recorded',
      gameId: h.gameId,
      gamePlayerId: h.gamePlayerId,
      totalValue: 65,
      rank: 1,
      totalPlayers: 1,
      capturedAt: '2026-05-25T00:00:00.000Z',
    });
    expect(await h.isUnlocked()).toBe(false);
  });
});
