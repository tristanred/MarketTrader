import { eq } from 'drizzle-orm';
import { defineAchievement } from '../define.js';
import { schema } from '../../db/index.js';

/**
 * Boolean unlock for dropping at least 3 ranks day-over-day. Mirrors
 * {@link comebackKid} but in the opposite direction. Reads
 * `game_player_stats.previousDayRank`.
 */
export default defineAchievement({
  key: 'free-fall',
  name: 'Free Fall',
  description: 'Drop 3 or more ranks day-over-day.',
  rarity: 'uncommon',
  icon: 'arrow-down-from-line',
  category: 'standing',
  target: 1,
  events: ['snapshot.recorded'],
  async onEvent(event, ctx) {
    const [stats] = await ctx.db
      .select({ previousDayRank: schema.gamePlayerStats.previousDayRank })
      .from(schema.gamePlayerStats)
      .where(eq(schema.gamePlayerStats.gamePlayerId, event.gamePlayerId))
      .limit(1);
    if (!stats || stats.previousDayRank == null) return;
    if (event.rank - stats.previousDayRank >= 3) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
