import { defineAchievement } from '../define.js';

/** Counter achievement: execute 67 trades of any direction. */
export default defineAchievement({
  key: 'six-seven',
  name: 'Six Seven',
  description: 'Execute 67 trades.',
  rarity: 'epic',
  icon: 'dice-6',
  category: 'trading',
  target: 67,
  events: ['trade.executed'],
  async onEvent(event, ctx) {
    await ctx.increment(event.gamePlayerId, 1);
  },
});
