import { defineAchievement } from '../define.js';

/**
 * Boolean unlock the first time the player reaches rank 1 at any snapshot.
 */
export default defineAchievement({
  key: 'top-of-the-class',
  name: 'Top of the Class',
  description: 'Reach rank 1 at any point during the game.',
  rarity: 'common',
  icon: 'award',
  category: 'standing',
  target: 1,
  events: ['snapshot.recorded'],
  async onEvent(event, ctx) {
    if (event.rank === 1) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
