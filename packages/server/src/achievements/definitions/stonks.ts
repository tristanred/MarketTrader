import { defineAchievement } from '../define.js';
import { getAllMarks } from '../../services/position-high-water.js';

/**
 * Boolean unlock: any currently open position is up 10% or more relative
 * to its average cost basis. Reads from `position_high_water` rather than
 * recomputing pnl per snapshot.
 */
export default defineAchievement({
  key: 'stonks',
  name: 'Stonks',
  description: 'Hold a position currently up 10% or more.',
  rarity: 'common',
  icon: 'trending-up',
  category: 'behavior',
  target: 1,
  events: ['snapshot.recorded'],
  async onEvent(event, ctx) {
    const marks = await getAllMarks(ctx.db, event.gamePlayerId);
    if (marks.some((m) => m.peakPnlPct >= 0.1)) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
