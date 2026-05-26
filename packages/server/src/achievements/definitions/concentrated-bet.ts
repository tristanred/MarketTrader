import { eq } from 'drizzle-orm';
import { defineAchievement } from '../define.js';
import { schema } from '../../db/index.js';

/**
 * Boolean unlock for entering a buy that consumes 50% or more of the cash on
 * hand at order entry. The event fires AFTER the trade commits, so we reverse
 * the cash delta: `cashBefore = cashAfter + (price * quantity)`. This is
 * exact for non-resting buys (which is all market/limit fills that emit
 * `trade.executed`); resting-order cash reservations aren't a factor since
 * the reservation is released and re-charged on fill.
 */
export default defineAchievement({
  key: 'concentrated-bet',
  name: 'Concentrated Bet',
  description: 'Open a single new position worth 50% or more of available cash at order entry.',
  rarity: 'uncommon',
  icon: 'crosshair',
  category: 'portfolio',
  target: 1,
  events: ['trade.executed'],
  async onEvent(event, ctx) {
    if (event.direction !== 'buy') return;
    const [player] = await ctx.db
      .select({ cashBalance: schema.gamePlayers.cashBalance })
      .from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.id, event.gamePlayerId))
      .limit(1);
    if (!player) return;
    const cashAfter = Number(player.cashBalance);
    const cost = event.price * event.quantity;
    const cashBefore = cashAfter + cost;
    if (cashBefore <= 0) return;
    if (cost / cashBefore >= 0.5) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
