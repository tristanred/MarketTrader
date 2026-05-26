import { eq } from 'drizzle-orm';
import { defineAchievement } from '../define.js';
import { schema } from '../../db/index.js';

/**
 * Boolean unlock for climbing at least 3 ranks day-over-day. Reads
 * `game_player_stats.previousDayRank` — populated on the rollover branch of
 * `applySnapshotStats` BEFORE `lastDayRank` is overwritten — and compares it
 * to the current snapshot's rank. Fires on every snapshot of the post-
 * rollover day where the delta still holds, but `unlock` is idempotent.
 */
export default defineAchievement({
  key: 'comeback-kid',
  name: 'Comeback Kid',
  description: 'Climb 3 or more ranks day-over-day.',
  rarity: 'rare',
  icon: 'arrow-up-from-line',
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
    if (stats.previousDayRank - event.rank >= 3) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
