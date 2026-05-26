import { eq } from 'drizzle-orm';
import { defineAchievement } from '../define.js';
import { schema } from '../../db/index.js';

/** Boolean unlock when total portfolio value drops to 50% or less of starting balance. */
export default defineAchievement({
  key: 'underwater',
  name: 'Underwater',
  description: 'Drop to 50% or less of your starting balance.',
  rarity: 'uncommon',
  icon: 'waves',
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
    if (event.totalValue <= 0.5 * Number(game.startingBalance)) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
