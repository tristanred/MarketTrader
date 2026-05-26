import { eq } from 'drizzle-orm';
import { defineAchievement } from '../define.js';
import { schema } from '../../db/index.js';

/** Boolean unlock when total portfolio value reaches 2x the starting balance. */
export default defineAchievement({
  key: 'double-up',
  name: 'Double Up',
  description: 'Reach 2x your starting balance.',
  rarity: 'epic',
  icon: 'arrow-up',
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
    if (event.totalValue >= 2 * Number(game.startingBalance)) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
