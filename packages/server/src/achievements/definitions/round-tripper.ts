import { defineAchievement } from '../define.js';
import { getAllMarks } from '../../services/position-high-water.js';
import { eq } from 'drizzle-orm';
import { schema } from '../../db/index.js';

/**
 * Boolean unlock: any currently open position reached +50% peak and has
 * since fallen back to -10% or worse, without being sold. Reads peakPnlPct
 * from position_high_water and current pnlPct from the live holding.
 */
export default defineAchievement({
  key: 'round-tripper',
  name: 'Round Tripper',
  description: 'Watch a position rise to +50% then fall back to -10% without selling.',
  rarity: 'rare',
  icon: 'rotate-ccw',
  category: 'pnl',
  target: 1,
  events: ['snapshot.recorded'],
  async onEvent(event, ctx) {
    const marks = await getAllMarks(ctx.db, event.gamePlayerId);
    if (marks.length === 0) return;
    const holdings = await ctx.db
      .select({
        symbol: schema.portfolios.symbol,
        avgCostBasis: schema.portfolios.avgCostBasis,
        currentPrice: schema.stockPriceCache.price,
      })
      .from(schema.portfolios)
      .leftJoin(schema.stockPriceCache, eq(schema.stockPriceCache.symbol, schema.portfolios.symbol))
      .where(eq(schema.portfolios.gamePlayerId, event.gamePlayerId));

    const pnlBySymbol = new Map<string, number>();
    for (const h of holdings) {
      if (h.currentPrice == null) continue;
      const cost = Number(h.avgCostBasis);
      if (cost <= 0) continue;
      pnlBySymbol.set(h.symbol, Number(h.currentPrice) / cost - 1);
    }

    if (marks.some((m) => m.peakPnlPct >= 0.5 && (pnlBySymbol.get(m.symbol) ?? 0) <= -0.1)) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
