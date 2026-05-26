import { defineAchievement } from '../define.js';

/** Boolean unlock fired the moment a player's first sell trade executes. */
export default defineAchievement({
  key: 'first-sale',
  name: 'First Sale',
  description: 'Execute your first sell.',
  rarity: 'common',
  icon: 'tag',
  category: 'trading',
  target: 1,
  events: ['trade.executed'],
  async onEvent(event, ctx) {
    if (event.direction === 'sell') {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
