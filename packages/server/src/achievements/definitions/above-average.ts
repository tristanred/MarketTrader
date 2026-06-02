import { defineAchievement } from '../define.js';
import { progressFromStat } from '../stat-progress.js';

/**
 * Progress achievement: stay at or above median rank for 7 consecutive days.
 * Reads `game_player_stats.consecutiveDaysAtOrAboveMedian`.
 */
export default defineAchievement({
  key: 'above-average',
  name: 'Above Average',
  description: 'Be at or above median rank on 7 consecutive days.',
  rarity: 'uncommon',
  icon: 'chart-line',
  category: 'standing',
  target: 7,
  events: ['snapshot.recorded'],
  onEvent: progressFromStat('consecutiveDaysAtOrAboveMedian'),
});
