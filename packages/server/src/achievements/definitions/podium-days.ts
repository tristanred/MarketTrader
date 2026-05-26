import { eq } from 'drizzle-orm';
import { defineAchievement } from '../define.js';
import { schema } from '../../db/index.js';

/**
 * Progress achievement: cumulative 5 days in the top 3. Reads
 * `game_player_stats.daysInTopThree`.
 */
export default defineAchievement({
  key: 'podium-days',
  name: 'Podium',
  description: 'Be in the top 3 on 5 cumulative days.',
  rarity: 'uncommon',
  icon: 'medal',
  category: 'standing',
  target: 5,
  events: ['snapshot.recorded'],
  async onEvent(event, ctx) {
    const [stats] = await ctx.db
      .select({ value: schema.gamePlayerStats.daysInTopThree })
      .from(schema.gamePlayerStats)
      .where(eq(schema.gamePlayerStats.gamePlayerId, event.gamePlayerId))
      .limit(1);
    if (!stats) return;
    await ctx.setProgress(event.gamePlayerId, stats.value);
  },
});
