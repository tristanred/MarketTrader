import { defineAchievement } from '../define.js';

/** Boolean unlock fired the moment a player's first trade executes. */
export default defineAchievement({
  key: 'first-trade',
  name: 'First Trade',
  description: 'Execute your first trade.',
  rarity: 'common',
  icon: 'circle-dot',
  category: 'trading',
  target: 1,
  events: ['trade.executed'],
  async onEvent(event, ctx) {
    await ctx.unlock(event.gamePlayerId);
  },
});
