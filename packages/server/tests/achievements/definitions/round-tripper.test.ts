import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import { onPositionOpened, updateMarks } from '../../../src/services/position-high-water.js';
import roundTripper from '../../../src/achievements/definitions/round-tripper.js';
import * as schema from '../../../src/db/schema.sqlite.js';

describe('achievement: round-tripper', () => {
  it('unlocks when a position peaked at +60% then fell back to -15%', async () => {
    const h = await makeAchievementHarness(roundTripper);
    // Insert portfolio row (cost basis $100)
    await h.db.insert(schema.portfolios).values({
      gamePlayerId: h.gamePlayerId,
      symbol: 'AAPL',
      quantity: 1,
      avgCostBasis: 100,
    });
    // Seed high-water mark; push peak to +60%
    await onPositionOpened(h.db, { gamePlayerId: h.gamePlayerId, symbol: 'AAPL', openedAt: '2026-05-20T00:00:00.000Z', currentPrice: 100, quantity: 1, avgCostBasis: 100 });
    await updateMarks(h.db, h.gamePlayerId, [{ symbol: 'AAPL', currentPrice: 160, quantity: 1, avgCostBasis: 100 }]);
    // Current price dropped to $85 (-15%)
    await h.db
      .insert(schema.stockPriceCache)
      .values({ symbol: 'AAPL', price: 85, change: -15, changePercent: -0.15 })
      .onConflictDoUpdate({ target: schema.stockPriceCache.symbol, set: { price: 85 } });
    await h.dispatch({
      type: 'snapshot.recorded',
      gameId: h.gameId,
      gamePlayerId: h.gamePlayerId,
      totalValue: 85,
      rank: 1,
      totalPlayers: 1,
      capturedAt: '2026-05-27T00:00:00.000Z',
    });
    expect(await h.isUnlocked()).toBe(true);
  });

  it('does not unlock when peak was only +30%', async () => {
    const h = await makeAchievementHarness(roundTripper);
    // Insert portfolio row (cost basis $100)
    await h.db.insert(schema.portfolios).values({
      gamePlayerId: h.gamePlayerId,
      symbol: 'MSFT',
      quantity: 1,
      avgCostBasis: 100,
    });
    // Peak only +30%
    await onPositionOpened(h.db, { gamePlayerId: h.gamePlayerId, symbol: 'MSFT', openedAt: '2026-05-20T00:00:00.000Z', currentPrice: 100, quantity: 1, avgCostBasis: 100 });
    await updateMarks(h.db, h.gamePlayerId, [{ symbol: 'MSFT', currentPrice: 130, quantity: 1, avgCostBasis: 100 }]);
    // Current price dropped to $85 (-15%)
    await h.db
      .insert(schema.stockPriceCache)
      .values({ symbol: 'MSFT', price: 85, change: -15, changePercent: -0.15 })
      .onConflictDoUpdate({ target: schema.stockPriceCache.symbol, set: { price: 85 } });
    await h.dispatch({
      type: 'snapshot.recorded',
      gameId: h.gameId,
      gamePlayerId: h.gamePlayerId,
      totalValue: 85,
      rank: 1,
      totalPlayers: 1,
      capturedAt: '2026-05-27T00:00:00.000Z',
    });
    expect(await h.isUnlocked()).toBe(false);
  });
});
