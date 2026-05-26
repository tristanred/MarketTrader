import { defineAchievement } from '../define.js';

/**
 * Boolean unlock when the player simultaneously holds at least 10 distinct
 * symbols. Reads `distinctSymbols` straight off the `holdings.changed` event.
 */
export default defineAchievement({
  key: 'diversified',
  name: 'Diversified',
  description: 'Hold 10 or more distinct symbols simultaneously.',
  rarity: 'uncommon',
  icon: 'pie-chart',
  category: 'portfolio',
  target: 1,
  events: ['holdings.changed'],
  async onEvent(event, ctx) {
    if (event.distinctSymbols >= 10) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
