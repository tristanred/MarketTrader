import { defineAchievement } from '../define.js';

/** Counter achievement: execute 25 trades of any direction. */
export default defineAchievement({
  key: 'day-trader',
  name: 'Day Trader',
  description: 'Execute 25 trades.',
  rarity: 'uncommon',
  icon: 'activity',
  category: 'trading',
  target: 25,
  events: ['trade.executed'],
  async onEvent(event, ctx) {
    await ctx.increment(event.gamePlayerId, 1);
  },
});
