import { and, eq, gte, ne, sql } from 'drizzle-orm';
import { defineAchievement } from '../define.js';
import { schema } from '../../db/index.js';

/**
 * Boolean unlock for buying a symbol within 5 minutes of another player in the
 * same game opening a position in it. Looks at the {@link schema.portfolios}
 * table joined to {@link schema.gamePlayers} to scope by game; matches any
 * other-player row whose `openedAt` is inside the 5-minute window before the
 * buy's executedAt.
 */
export default defineAchievement({
  key: 'fomo',
  name: 'FOMO',
  description: 'Buy a symbol within 5 minutes of another player opening it in this game.',
  rarity: 'rare',
  icon: 'flame',
  category: 'behavior',
  target: 1,
  events: ['trade.executed'],
  async onEvent(event, ctx) {
    if (event.direction !== 'buy') return;
    const fiveMinAgo = new Date(
      new Date(event.executedAt).getTime() - 5 * 60 * 1000,
    ).toISOString();
    const [firstHolder] = await ctx.db
      .select({
        gamePlayerId: schema.portfolios.gamePlayerId,
        openedAt: schema.portfolios.openedAt,
      })
      .from(schema.portfolios)
      .innerJoin(schema.gamePlayers, eq(schema.gamePlayers.id, schema.portfolios.gamePlayerId))
      .where(
        and(
          eq(schema.gamePlayers.gameId, ctx.gameId),
          eq(schema.portfolios.symbol, event.symbol),
          ne(schema.portfolios.gamePlayerId, event.gamePlayerId),
          gte(schema.portfolios.openedAt, fiveMinAgo),
          sql`${schema.portfolios.openedAt} IS NOT NULL`,
        ),
      )
      .orderBy(schema.portfolios.openedAt)
      .limit(1);
    if (firstHolder) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
