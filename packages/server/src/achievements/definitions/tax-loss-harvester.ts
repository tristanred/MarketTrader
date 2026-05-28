import { eq } from 'drizzle-orm';
import { defineAchievement } from '../define.js';
import { schema } from '../../db/index.js';

/**
 * Counter achievement: close 3 losing positions in a single UTC day.
 * Reads `game_player_stats.losingSellsToday`, maintained by the
 * position-close stats rollup with a UTC day-rollover branch.
 */
export default defineAchievement({
  key: 'tax-loss-harvester',
  name: 'Tax Loss Harvester',
  description: 'Close 3 losing positions in a single UTC day.',
  rarity: 'uncommon',
  icon: 'receipt',
  category: 'trading',
  target: 3,
  events: ['position.closed'],
  async onEvent(event, ctx) {
    if (event.realizedPnl >= 0) return;
    const [stats] = await ctx.db
      .select({ value: schema.gamePlayerStats.losingSellsToday })
      .from(schema.gamePlayerStats)
      .where(eq(schema.gamePlayerStats.gamePlayerId, event.gamePlayerId))
      .limit(1);
    if (!stats) return;
    await ctx.setProgress(event.gamePlayerId, stats.value);
  },
});
