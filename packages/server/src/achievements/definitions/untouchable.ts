import { eq } from 'drizzle-orm';
import { defineAchievement } from '../define.js';
import { schema } from '../../db/index.js';

/**
 * Progress achievement: cumulative 7 days at rank 1 (not necessarily
 * consecutive). Reads `game_player_stats.daysAtRankOne`.
 */
export default defineAchievement({
  key: 'untouchable',
  name: 'Untouchable',
  description: 'Be rank 1 on 7 cumulative days.',
  rarity: 'epic',
  icon: 'shield',
  category: 'standing',
  target: 7,
  events: ['snapshot.recorded'],
  async onEvent(event, ctx) {
    const [stats] = await ctx.db
      .select({ value: schema.gamePlayerStats.daysAtRankOne })
      .from(schema.gamePlayerStats)
      .where(eq(schema.gamePlayerStats.gamePlayerId, event.gamePlayerId))
      .limit(1);
    if (!stats) return;
    await ctx.setProgress(event.gamePlayerId, stats.value);
  },
});
