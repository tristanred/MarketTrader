import { defineAchievement } from '../define.js';

/** Counter achievement: execute 50 trades of any direction. */
export default defineAchievement({
  key: 'market-maker',
  name: 'Market Maker',
  description: 'Execute 50 trades.',
  rarity: 'rare',
  icon: 'briefcase',
  category: 'trading',
  target: 50,
  events: ['trade.executed'],
  async onEvent(event, ctx) {
    await ctx.increment(event.gamePlayerId, 1);
  },
});
