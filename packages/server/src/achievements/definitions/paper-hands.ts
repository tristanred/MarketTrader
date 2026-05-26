import { defineAchievement } from '../define.js';

/**
 * Boolean unlock for fully closing a position less than 5 minutes after opening
 * it. Uses {@link import('../../events/types.js').PositionClosedEvent.holdDurationMs}
 * which the trade pipeline measures from the most recent 0→positive open.
 */
export default defineAchievement({
  key: 'paper-hands',
  name: 'Paper Hands',
  description: 'Close a position less than 5 minutes after opening it.',
  rarity: 'common',
  icon: 'feather',
  category: 'behavior',
  target: 1,
  events: ['position.closed'],
  async onEvent(event, ctx) {
    if (event.holdDurationMs < 5 * 60 * 1000) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
