import { defineAchievement } from '../define.js';

/**
 * Streak achievement: be in last place on the leaderboard for 5 consecutive
 * portfolio snapshots. Demonstrates the `setProgress(0)` reset pattern.
 */
export default defineAchievement({
  key: 'rock-bottom',
  name: 'Rock Bottom',
  description: 'Be last on the leaderboard for 5 snapshots in a row.',
  rarity: 'epic',
  icon: 'trending-down',
  category: 'standing',
  target: 5,
  events: ['snapshot.recorded'],
  async onEvent(event, ctx) {
    if (event.totalPlayers <= 1) return;
    if (event.rank === event.totalPlayers) {
      await ctx.increment(event.gamePlayerId, 1);
    } else {
      await ctx.setProgress(event.gamePlayerId, 0);
    }
  },
});
