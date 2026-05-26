import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { defineAchievement } from '../define.js';
import { schema } from '../../db/index.js';

/**
 * Boolean unlock for re-buying a symbol within 1 hour of having sold it. Fires
 * on `trade.executed` for buys; looks back for any prior executed sell of the
 * same symbol by the same player within the hour. The buy trade itself is
 * excluded to avoid self-matches if the event is delivered for a sell that
 * shares an id with the current buy (defensive — direction filter already
 * narrows to sells).
 */
export default defineAchievement({
  key: 'revenge-trade',
  name: 'Revenge Trade',
  description: 'Re-buy a symbol within 1 hour of selling it.',
  rarity: 'uncommon',
  icon: 'swords',
  category: 'behavior',
  target: 1,
  events: ['trade.executed'],
  async onEvent(event, ctx) {
    if (event.direction !== 'buy') return;
    const oneHourAgo = new Date(
      new Date(event.executedAt).getTime() - 60 * 60 * 1000,
    ).toISOString();
    const [recentSell] = await ctx.db
      .select({ id: schema.trades.id })
      .from(schema.trades)
      .where(
        and(
          eq(schema.trades.gamePlayerId, event.gamePlayerId),
          eq(schema.trades.symbol, event.symbol),
          eq(schema.trades.direction, 'sell'),
          eq(schema.trades.status, 'executed'),
          gte(schema.trades.executedAt, oneHourAgo),
          sql`${schema.trades.id} != ${event.tradeId}`,
        ),
      )
      .orderBy(desc(schema.trades.executedAt))
      .limit(1);
    if (recentSell) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
