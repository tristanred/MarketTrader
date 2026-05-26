import { eq } from 'drizzle-orm';
import { defineAchievement } from '../define.js';
import { schema } from '../../db/index.js';

/**
 * Boolean unlock for going to 100% cash after having traded at least 5
 * distinct symbols — represents an active de-risk, not the empty starting
 * state. Uses `distinctSymbolsTradedEver` (game-lifetime count) as the
 * "has the player been actively trading" proxy.
 */
export default defineAchievement({
  key: 'cash-is-king',
  name: 'Cash Is King',
  description: 'Go to 100% cash after having held at least 5 distinct symbols this game.',
  rarity: 'uncommon',
  icon: 'banknote',
  category: 'portfolio',
  target: 1,
  events: ['holdings.changed'],
  async onEvent(event, ctx) {
    if (event.distinctSymbols !== 0) return;
    const [stats] = await ctx.db
      .select({ distinctEver: schema.gamePlayerStats.distinctSymbolsTradedEver })
      .from(schema.gamePlayerStats)
      .where(eq(schema.gamePlayerStats.gamePlayerId, event.gamePlayerId))
      .limit(1);
    if (!stats) return;
    if (stats.distinctEver >= 5) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
