import { defineAchievement } from '../define.js';

/**
 * Boolean unlock when the player simultaneously holds at least 20 distinct
 * symbols — the diversification ceiling above {@link diversified}.
 */
export default defineAchievement({
  key: 'index-fund',
  name: 'Index Fund',
  description: 'Hold 20 or more distinct symbols simultaneously.',
  rarity: 'rare',
  icon: 'layout-grid',
  category: 'portfolio',
  target: 1,
  events: ['holdings.changed'],
  async onEvent(event, ctx) {
    if (event.distinctSymbols >= 20) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
