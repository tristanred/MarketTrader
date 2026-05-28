import { defineAchievement } from '../define.js';
import { getAllMarks } from '../../services/position-high-water.js';

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Boolean unlock: any currently held position has dropped to -30% or worse
 * AND has been held for at least 3 days since the most recent 0→positive open.
 */
export default defineAchievement({
  key: 'this-is-fine',
  name: 'This Is Fine',
  description: 'Hold a position down 30% or more for 3 days or more.',
  rarity: 'rare',
  icon: 'flame',
  category: 'behavior',
  target: 1,
  events: ['snapshot.recorded'],
  async onEvent(event, ctx) {
    const marks = await getAllMarks(ctx.db, event.gamePlayerId);
    const now = new Date(event.capturedAt).getTime();
    if (
      marks.some(
        (m) =>
          m.troughPnlPct <= -0.3 &&
          now - new Date(m.openedAt).getTime() >= THREE_DAYS_MS,
      )
    ) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
