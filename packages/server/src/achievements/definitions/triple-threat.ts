import { eq } from 'drizzle-orm';
import { defineAchievement } from '../define.js';
import { schema } from '../../db/index.js';

/** Boolean unlock when total portfolio value reaches 3x the starting balance. */
export default defineAchievement({
  key: 'triple-threat',
  name: 'Triple Threat',
  description: 'Reach 3x your starting balance.',
  rarity: 'legendary',
  icon: 'crown',
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
    if (event.totalValue >= 3 * Number(game.startingBalance)) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
