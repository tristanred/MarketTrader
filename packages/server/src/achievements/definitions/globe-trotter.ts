import { eq } from 'drizzle-orm';
import { defineAchievement } from '../define.js';
import { schema } from '../../db/index.js';

/**
 * Progress achievement: trade 15 distinct symbols. Reads the canonical count
 * from `game_player_stats.distinctSymbolsTradedEver`, which is updated
 * synchronously inside the trade transaction by `applyTradeStats`.
 */
export default defineAchievement({
  key: 'globe-trotter',
  name: 'Globe Trotter',
  description: 'Trade 15 distinct symbols.',
  rarity: 'uncommon',
  icon: 'globe',
  category: 'trading',
  target: 15,
  events: ['trade.executed'],
  async onEvent(event, ctx) {
    const [stats] = await ctx.db
      .select({ distinct: schema.gamePlayerStats.distinctSymbolsTradedEver })
      .from(schema.gamePlayerStats)
      .where(eq(schema.gamePlayerStats.gamePlayerId, event.gamePlayerId))
      .limit(1);
    if (!stats) return;
    await ctx.setProgress(event.gamePlayerId, stats.distinct);
  },
});
