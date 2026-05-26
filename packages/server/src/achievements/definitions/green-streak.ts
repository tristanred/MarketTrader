import { eq } from 'drizzle-orm';
import { defineAchievement } from '../define.js';
import { schema } from '../../db/index.js';

/**
 * Progress achievement: 5 consecutive winning closes. Reads
 * `game_player_stats.consecutiveWins` which is reset to 0 by the trade
 * pipeline on any losing close.
 */
export default defineAchievement({
  key: 'green-streak',
  name: 'Green Streak',
  description: 'Close 5 winning positions in a row.',
  rarity: 'uncommon',
  icon: 'trending-up',
  category: 'pnl',
  target: 5,
  events: ['position.closed'],
  async onEvent(event, ctx) {
    const [stats] = await ctx.db
      .select({ wins: schema.gamePlayerStats.consecutiveWins })
      .from(schema.gamePlayerStats)
      .where(eq(schema.gamePlayerStats.gamePlayerId, event.gamePlayerId))
      .limit(1);
    if (!stats) return;
    await ctx.setProgress(event.gamePlayerId, stats.wins);
  },
});
