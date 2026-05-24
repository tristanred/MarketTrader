import { defineAchievement } from '../define.js';

/** Counter achievement: ten buy-direction trade executions in the game. */
export default defineAchievement({
  key: 'ten-buys',
  name: 'Active Trader',
  description: 'Buy stocks 10 times.',
  category: 'trading',
  target: 10,
  events: ['trade.executed'],
  async onEvent(event, ctx) {
    if (event.direction === 'buy') {
      await ctx.increment(event.gamePlayerId, 1);
    }
  },
});
