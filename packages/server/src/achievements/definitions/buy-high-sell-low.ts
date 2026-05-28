import { defineAchievement } from '../define.js';

/** Boolean unlock: realize a loss of 25% or more on a single sell. */
export default defineAchievement({
  key: 'buy-high-sell-low',
  name: 'Buy High, Sell Low',
  description: 'Realize a loss of 25% or more on a single sell.',
  rarity: 'common',
  icon: 'trending-down',
  category: 'pnl',
  target: 1,
  events: ['position.closed'],
  async onEvent(event, ctx) {
    if (event.realizedPnlPct <= -0.25) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
