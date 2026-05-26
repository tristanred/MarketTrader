import { defineAchievement } from '../define.js';

/** Boolean unlock for closing a single position with at least 50% loss. */
export default defineAchievement({
  key: 'bag-holder',
  name: 'Bag Holder',
  description: 'Close a single position with at least 50% loss.',
  rarity: 'uncommon',
  icon: 'package',
  category: 'pnl',
  target: 1,
  events: ['position.closed'],
  async onEvent(event, ctx) {
    if (event.realizedPnlPct <= -0.5) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
