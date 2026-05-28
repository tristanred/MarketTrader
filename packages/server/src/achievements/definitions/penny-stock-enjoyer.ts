import { defineAchievement } from '../define.js';

/** Boolean unlock: buy a stock priced under $5. */
export default defineAchievement({
  key: 'penny-stock-enjoyer',
  name: 'Penny Stock Enjoyer',
  description: 'Buy a stock priced under $5.',
  rarity: 'uncommon',
  icon: 'coins',
  category: 'behavior',
  target: 1,
  events: ['trade.executed'],
  async onEvent(event, ctx) {
    if (event.direction === 'buy' && event.price < 5) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
