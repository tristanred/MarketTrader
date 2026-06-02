import { defineAchievement } from '../define.js';
import { progressFromStat } from '../stat-progress.js';

/**
 * Progress achievement: cumulative 7 days at rank 1 (not necessarily
 * consecutive). Reads `game_player_stats.daysAtRankOne`.
 */
export default defineAchievement({
  key: 'untouchable',
  name: 'Untouchable',
  description: 'Be rank 1 on 7 cumulative days.',
  rarity: 'epic',
  icon: 'shield',
  category: 'standing',
  target: 7,
  events: ['snapshot.recorded'],
  onEvent: progressFromStat('daysAtRankOne'),
});
