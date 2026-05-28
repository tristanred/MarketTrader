import { defineAchievement } from '../define.js';
import { getMarks } from '../../services/position-high-water.js';

/**
 * Boolean unlock: close a position green (realized pnl ≥ 0) after the
 * position's trough dropped to -20% or worse during the hold. Reads
 * position_high_water BEFORE the trade pipeline's onPositionClosed
 * deletes the row — verified in B3 by routing the delete through
 * trade-emit.ts AFTER awaiting the position.closed emit.
 */
export default defineAchievement({
  key: 'diamond-plated-hands',
  name: 'Diamond-Plated Hands',
  description: 'Close a position green after surviving a 20%+ drawdown while holding it.',
  rarity: 'legendary',
  icon: 'gem',
  category: 'pnl',
  target: 1,
  events: ['position.closed'],
  async onEvent(event, ctx) {
    if (event.realizedPnlPct < 0) return;
    const marks = await getMarks(ctx.db, event.gamePlayerId, event.symbol);
    if (!marks) return;
    if (marks.troughPnlPct <= -0.2) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
