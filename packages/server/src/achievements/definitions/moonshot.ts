import { defineAchievement } from '../define.js';

/** Boolean unlock for closing a single position with at least +50% gain. */
export default defineAchievement({
  key: 'moonshot',
  name: 'Moonshot',
  description: 'Close a single position with at least 50% gain.',
  rarity: 'rare',
  icon: 'rocket',
  category: 'pnl',
  target: 1,
  events: ['position.closed'],
  async onEvent(event, ctx) {
    if (event.realizedPnlPct >= 0.5) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
