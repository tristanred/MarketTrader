import { defineAchievement } from '../define.js';

/** Boolean unlock: execute a trade with total value under $10. */
export default defineAchievement({
  key: 'dollar-menu',
  name: 'Dollar Menu',
  description: 'Execute a trade with total value under $10.',
  rarity: 'common',
  icon: 'utensils',
  category: 'behavior',
  target: 1,
  events: ['trade.executed'],
  async onEvent(event, ctx) {
    if (event.price * event.quantity < 10) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
