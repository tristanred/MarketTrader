import { eq } from 'drizzle-orm';
import { defineAchievement } from '../define.js';
import { schema } from '../../db/index.js';

/**
 * Counter achievement: execute 20 trades in a single UTC day. Reads
 * `game_player_stats.tradesToday`, which the trade-stats rollup
 * maintains with a UTC day-rollover branch.
 */
export default defineAchievement({
  key: 'sir-this-is-a-wendys',
  name: "Sir, This Is a Wendy's",
  description: 'Execute 20 trades in a single UTC day.',
  rarity: 'legendary',
  icon: 'utensils-crossed',
  category: 'trading',
  target: 20,
  events: ['trade.executed'],
  async onEvent(event, ctx) {
    const [stats] = await ctx.db
      .select({ value: schema.gamePlayerStats.tradesToday })
      .from(schema.gamePlayerStats)
      .where(eq(schema.gamePlayerStats.gamePlayerId, event.gamePlayerId))
      .limit(1);
    if (!stats) return;
    await ctx.setProgress(event.gamePlayerId, stats.value);
  },
});
