import { defineAchievement } from '../define.js';

/**
 * Boolean unlock when one position represents 90% or more of total portfolio
 * value — extreme concentration. Reads `topConcentrationRatio` straight off
 * the `holdings.changed` event.
 */
export default defineAchievement({
  key: 'all-in',
  name: 'All In',
  description: 'Hold a single position worth 90% or more of portfolio value.',
  rarity: 'uncommon',
  icon: 'target',
  category: 'portfolio',
  target: 1,
  events: ['holdings.changed'],
  async onEvent(event, ctx) {
    if (event.topConcentrationRatio >= 0.9) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
