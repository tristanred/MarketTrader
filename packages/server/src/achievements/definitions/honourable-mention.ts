import { defineAchievement } from '../define.js';

/**
 * Boolean unlock for finishing in the top half of the final standings. Only
 * awarded in games with at least 4 players so the cut-off is meaningful.
 */
export default defineAchievement({
  key: 'honourable-mention',
  name: 'Honourable Mention',
  description: 'Finish in the top half of the leaderboard (requires 4+ players).',
  rarity: 'common',
  icon: 'bookmark',
  category: 'finale',
  target: 1,
  events: ['game.ended'],
  async onEvent(event, ctx) {
    if (event.finalRanking.length < 4) return;
    const cutoff = Math.floor(event.finalRanking.length / 2);
    for (const entry of event.finalRanking) {
      if (entry.rank <= cutoff) {
        await ctx.unlock(entry.gamePlayerId);
      }
    }
  },
});
