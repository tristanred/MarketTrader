import { defineAchievement } from '../define.js';
import { progressFromStat } from '../stat-progress.js';

/**
 * Progress achievement: 5 consecutive winning closes. Reads
 * `game_player_stats.consecutiveWins` which is reset to 0 by the trade
 * pipeline on any losing close.
 */
export default defineAchievement({
  key: 'green-streak',
  name: 'Green Streak',
  description: 'Close 5 winning positions in a row.',
  rarity: 'uncommon',
  icon: 'trending-up',
  category: 'pnl',
  target: 5,
  events: ['position.closed'],
  onEvent: progressFromStat('consecutiveWins'),
});
