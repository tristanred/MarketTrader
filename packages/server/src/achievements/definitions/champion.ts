import { defineAchievement } from '../define.js';

/**
 * Boolean unlock awarded to the player finishing at rank 1 when the game ends.
 */
export default defineAchievement({
  key: 'champion',
  name: 'Champion',
  description: 'Finish the game in 1st place.',
  rarity: 'epic',
  icon: 'trophy',
  category: 'finale',
  target: 1,
  events: ['game.ended'],
  async onEvent(event, ctx) {
    for (const entry of event.finalRanking) {
      if (entry.rank === 1) {
        await ctx.unlock(entry.gamePlayerId);
      }
    }
  },
});
