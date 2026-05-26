import { defineAchievement } from '../define.js';

/**
 * Boolean unlock for closing a position after holding it for at least 7 days.
 * Hold duration is measured from the most recent 0→positive open of the symbol
 * for this player.
 */
export default defineAchievement({
  key: 'diamond-hands',
  name: 'Diamond Hands',
  description: 'Close a position after holding it for 7 days or more.',
  rarity: 'rare',
  icon: 'diamond',
  category: 'behavior',
  target: 1,
  events: ['position.closed'],
  async onEvent(event, ctx) {
    if (event.holdDurationMs >= 7 * 24 * 60 * 60 * 1000) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
