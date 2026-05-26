import { defineAchievement } from '../define.js';

/**
 * Boolean unlock for finishing in the top 3 when the game ends.
 */
export default defineAchievement({
  key: 'podium-finish',
  name: 'Podium Finish',
  description: 'Finish the game in the top 3.',
  rarity: 'rare',
  icon: 'medal',
  category: 'finale',
  target: 1,
  events: ['game.ended'],
  async onEvent(event, ctx) {
    for (const entry of event.finalRanking) {
      if (entry.rank <= 3) {
        await ctx.unlock(entry.gamePlayerId);
      }
    }
  },
});
