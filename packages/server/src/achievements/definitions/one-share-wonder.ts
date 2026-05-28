import { defineAchievement } from '../define.js';

/** Boolean unlock: buy exactly 1 share of a stock priced over $500. */
export default defineAchievement({
  key: 'one-share-wonder',
  name: 'One Share Wonder',
  description: 'Buy exactly 1 share of a stock priced over $500.',
  rarity: 'common',
  icon: 'hash',
  category: 'behavior',
  target: 1,
  events: ['trade.executed'],
  async onEvent(event, ctx) {
    if (event.direction === 'buy' && event.quantity === 1 && event.price > 500) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
