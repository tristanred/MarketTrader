import { defineAchievement } from '../define.js';
import { getAllMarks } from '../../services/position-high-water.js';

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

/** Boolean unlock: any currently open position has been held for 14+ days. */
export default defineAchievement({
  key: 'hodl',
  name: 'HODL',
  description: 'Hold a single position continuously for 14 days.',
  rarity: 'uncommon',
  icon: 'anchor',
  category: 'behavior',
  target: 1,
  events: ['snapshot.recorded'],
  async onEvent(event, ctx) {
    const marks = await getAllMarks(ctx.db, event.gamePlayerId);
    const now = new Date(event.capturedAt).getTime();
    if (marks.some((m) => now - new Date(m.openedAt).getTime() >= FOURTEEN_DAYS_MS)) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
