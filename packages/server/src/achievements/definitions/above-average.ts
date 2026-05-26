import { eq } from 'drizzle-orm';
import { defineAchievement } from '../define.js';
import { schema } from '../../db/index.js';

/**
 * Progress achievement: stay at or above median rank for 7 consecutive days.
 * Reads `game_player_stats.consecutiveDaysAtOrAboveMedian`.
 */
export default defineAchievement({
  key: 'above-average',
  name: 'Above Average',
  description: 'Be at or above median rank on 7 consecutive days.',
  rarity: 'uncommon',
  icon: 'chart-line',
  category: 'standing',
  target: 7,
  events: ['snapshot.recorded'],
  async onEvent(event, ctx) {
    const [stats] = await ctx.db
      .select({ value: schema.gamePlayerStats.consecutiveDaysAtOrAboveMedian })
      .from(schema.gamePlayerStats)
      .where(eq(schema.gamePlayerStats.gamePlayerId, event.gamePlayerId))
      .limit(1);
    if (!stats) return;
    await ctx.setProgress(event.gamePlayerId, stats.value);
  },
});
