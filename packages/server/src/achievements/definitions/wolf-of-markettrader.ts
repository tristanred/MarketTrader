import { eq } from 'drizzle-orm';
import { defineAchievement } from '../define.js';
import { schema } from '../../db/index.js';

/**
 * Boolean unlock when cumulative realized P&L reaches 100% of the game's
 * starting balance — i.e. the player has doubled their starting cash purely
 * from closed positions.
 */
export default defineAchievement({
  key: 'wolf-of-markettrader',
  name: 'Wolf of MarketTrader',
  description: 'Cumulative realized P&L reaches 100% of starting balance.',
  rarity: 'epic',
  icon: 'medal',
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
    if (realizedPnl >= startingBalance) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
