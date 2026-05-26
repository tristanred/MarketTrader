import { defineAchievement } from '../define.js';

/**
 * Boolean unlock when the player drives cash to 1% or less of portfolio value
 * — fully deployed capital. Requires at least one held symbol so the brand-new
 * empty-portfolio state (cashRatio=1.0) can't trip the unlock if the math ever
 * rounds badly.
 */
export default defineAchievement({
  key: 'fully-invested',
  name: 'Fully Invested',
  description: 'Drive cash to 1% or less of portfolio value.',
  rarity: 'common',
  icon: 'piggy-bank',
  category: 'portfolio',
  target: 1,
  events: ['holdings.changed'],
  async onEvent(event, ctx) {
    if (event.cashRatio <= 0.01 && event.distinctSymbols > 0) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
