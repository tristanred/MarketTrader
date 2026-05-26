import { eq } from 'drizzle-orm';
import { defineAchievement } from '../define.js';
import { schema } from '../../db/index.js';

/**
 * Boolean unlock when cumulative realized P&L reaches 25% of the game's
 * starting balance. Reads both `game_player_stats.realizedPnl` (updated
 * synchronously in the trade pipeline) and `games.startingBalance`.
 */
export default defineAchievement({
  key: 'locked-in',
  name: 'Locked In',
  description: 'Cumulative realized P&L reaches 25% of starting balance.',
  rarity: 'uncommon',
  icon: 'lock',
  category: 'pnl',
  target: 1,
  events: ['position.closed'],
  async onEvent(event, ctx) {
    const [game] = await ctx.db
      .select({ startingBalance: schema.games.startingBalance })
      .from(schema.games)
      .where(eq(schema.games.id, ctx.gameId))
      .limit(1);
    if (!game) return;
    const [stats] = await ctx.db
      .select({ realizedPnl: schema.gamePlayerStats.realizedPnl })
      .from(schema.gamePlayerStats)
      .where(eq(schema.gamePlayerStats.gamePlayerId, event.gamePlayerId))
      .limit(1);
    if (!stats) return;
    const startingBalance = Number(game.startingBalance);
    const realizedPnl = Number(stats.realizedPnl);
    if (realizedPnl >= 0.25 * startingBalance) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
