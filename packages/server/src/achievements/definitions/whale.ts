import { eq } from 'drizzle-orm';
import { defineAchievement } from '../define.js';
import { schema } from '../../db/index.js';

/** Boolean unlock: execute a single trade worth 25% or more of starting balance. */
export default defineAchievement({
  key: 'whale',
  name: 'Whale',
  description: 'Execute a single trade worth 25% or more of starting balance.',
  rarity: 'epic',
  icon: 'fish',
  category: 'behavior',
  target: 1,
  events: ['trade.executed'],
  async onEvent(event, ctx) {
    const [game] = await ctx.db
      .select({ startingBalance: schema.games.startingBalance })
      .from(schema.games)
      .where(eq(schema.games.id, ctx.gameId))
      .limit(1);
    if (!game) return;
    if (event.price * event.quantity >= 0.25 * Number(game.startingBalance)) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
