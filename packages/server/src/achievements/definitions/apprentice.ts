import { defineAchievement } from '../define.js';

/** Counter achievement: execute 12 trades of any direction. */
export default defineAchievement({
  key: 'apprentice',
  name: 'Apprentice',
  description: 'Execute 12 trades.',
  rarity: 'common',
  icon: 'dumbbell',
  category: 'trading',
  target: 12,
  events: ['trade.executed'],
  async onEvent(event, ctx) {
    await ctx.increment(event.gamePlayerId, 1);
  },
});
