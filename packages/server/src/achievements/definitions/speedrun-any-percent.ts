import { eq } from 'drizzle-orm';
import { defineAchievement } from '../define.js';
import { schema } from '../../db/index.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** Boolean unlock: reach 2x starting balance within 7 days of game start. */
export default defineAchievement({
  key: 'speedrun-any-percent',
  name: 'Speedrun Any %',
  description: 'Reach 2x starting balance within 7 days of game start.',
  rarity: 'epic',
  icon: 'timer',
  category: 'pnl',
  target: 1,
  events: ['snapshot.recorded'],
  async onEvent(event, ctx) {
    const [game] = await ctx.db
      .select({ startingBalance: schema.games.startingBalance, startDate: schema.games.startDate })
      .from(schema.games)
      .where(eq(schema.games.id, ctx.gameId))
      .limit(1);
    if (!game) return;
    const startingBalance = Number(game.startingBalance);
    if (event.totalValue < 2 * startingBalance) return;
    const elapsed = new Date(event.capturedAt).getTime() - new Date(game.startDate).getTime();
    if (elapsed < SEVEN_DAYS_MS) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
