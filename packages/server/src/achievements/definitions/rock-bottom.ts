import { eq } from 'drizzle-orm';
import { defineAchievement } from '../define.js';
import { schema } from '../../db/index.js';

/**
 * Streak achievement: be in last place on the leaderboard for 3 consecutive
 * days. Mirrors `game_player_stats.consecutiveDaysInLastPlace`, which the
 * snapshot pipeline rolls up at the UTC-day boundary; we read it on every
 * snapshot event so the displayed progress tracks the stat in real time.
 */
export default defineAchievement({
  key: 'rock-bottom',
  name: 'Rock Bottom',
  description: 'Be last on the leaderboard for 3 days in a row.',
  rarity: 'epic',
  icon: 'trending-down',
  category: 'standing',
  target: 3,
  events: ['snapshot.recorded'],
  async onEvent(event, ctx) {
    if (event.totalPlayers <= 1) return;
    const [stats] = await ctx.db
      .select({ consec: schema.gamePlayerStats.consecutiveDaysInLastPlace })
      .from(schema.gamePlayerStats)
      .where(eq(schema.gamePlayerStats.gamePlayerId, event.gamePlayerId))
      .limit(1);
    if (!stats) return;
    await ctx.setProgress(event.gamePlayerId, stats.consec);
  },
});
