import { eq } from 'drizzle-orm';
import { defineAchievement } from '../define.js';
import { schema } from '../../db/index.js';

/**
 * Progress achievement: be rank 1 for 3 consecutive UTC days. Reads the
 * canonical counter from `game_player_stats.consecutiveDaysAtRankOne`, which
 * is advanced inside the snapshot transaction by `applySnapshotStats`.
 */
export default defineAchievement({
  key: 'reigning-champ',
  name: 'Reigning Champ',
  description: 'Be rank 1 on 3 consecutive days.',
  rarity: 'rare',
  icon: 'star',
  category: 'standing',
  target: 3,
  events: ['snapshot.recorded'],
  async onEvent(event, ctx) {
    const [stats] = await ctx.db
      .select({ value: schema.gamePlayerStats.consecutiveDaysAtRankOne })
      .from(schema.gamePlayerStats)
      .where(eq(schema.gamePlayerStats.gamePlayerId, event.gamePlayerId))
      .limit(1);
    if (!stats) return;
    await ctx.setProgress(event.gamePlayerId, stats.value);
  },
});
