import { defineAchievement } from '../define.js';

/**
 * Boolean unlock for a 10× return on a single position.
 * A 10× return is +900% gain, i.e. realizedPnlPct >= 9.0.
 */
export default defineAchievement({
  key: 'ten-bagger',
  name: 'Ten-Bagger',
  description: 'Close a single position with at least a 10x return.',
  rarity: 'legendary',
  icon: 'gem',
  category: 'pnl',
  target: 1,
  events: ['position.closed'],
  async onEvent(event, ctx) {
    if (event.realizedPnlPct >= 9.0) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
