import { eq } from 'drizzle-orm';
import { defineAchievement } from '../define.js';
import { schema } from '../../db/index.js';

/**
 * Boolean unlock for recovering to at least the starting balance after a
 * prior dip to 75% or below. Requires `game_player_stats.troughPortfolioValue`
 * to record the prior low (set by the snapshot pipeline).
 */
export default defineAchievement({
  key: 'phoenix',
  name: 'Phoenix',
  description: 'Drop to 75% or less of starting balance, then recover to at least starting balance.',
  rarity: 'rare',
  icon: 'feather',
  category: 'pnl',
  target: 1,
  events: ['snapshot.recorded'],
  async onEvent(event, ctx) {
    const [game] = await ctx.db
      .select({ startingBalance: schema.games.startingBalance })
      .from(schema.games)
      .where(eq(schema.games.id, ctx.gameId))
      .limit(1);
    if (!game) return;
    const [stats] = await ctx.db
      .select({ trough: schema.gamePlayerStats.troughPortfolioValue })
      .from(schema.gamePlayerStats)
      .where(eq(schema.gamePlayerStats.gamePlayerId, event.gamePlayerId))
      .limit(1);
    if (!stats || stats.trough == null) return;
    const startingBalance = Number(game.startingBalance);
    const trough = Number(stats.trough);
    if (trough <= 0.75 * startingBalance && event.totalValue >= startingBalance) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
