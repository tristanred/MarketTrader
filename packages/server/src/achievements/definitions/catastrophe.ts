import { defineAchievement } from '../define.js';

/** Boolean unlock for closing a single position with at least 90% loss. */
export default defineAchievement({
  key: 'catastrophe',
  name: 'Catastrophe',
  description: 'Close a single position with at least 90% loss.',
  rarity: 'rare',
  icon: 'flame',
  category: 'pnl',
  target: 1,
  events: ['position.closed'],
  async onEvent(event, ctx) {
    if (event.realizedPnlPct <= -0.9) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
