import { defineAchievement } from '../define.js';
import { progressFromStat } from '../stat-progress.js';

const mirrorConsecutiveLastPlace = progressFromStat('consecutiveDaysInLastPlace');

/**
 * Streak achievement: be in last place on the leaderboard for 3 consecutive
 * days. Mirrors `game_player_stats.consecutiveDaysInLastPlace`, which the
 * snapshot pipeline rolls up at the UTC-day boundary; we read it on every
 * snapshot event so the displayed progress tracks the stat in real time.
 */
export default defineAchievement({
  key: 'rock-bottom',
  name: 'Rock Bottom',
  description: 'Be last on the leaderboard for 3 days in a row.',
  rarity: 'epic',
  icon: 'trending-down',
  category: 'standing',
  target: 3,
  events: ['snapshot.recorded'],
  async onEvent(event, ctx) {
    // Last place is meaningless in a one-player game.
    if (event.totalPlayers <= 1) return;
    await mirrorConsecutiveLastPlace(event, ctx);
  },
});
