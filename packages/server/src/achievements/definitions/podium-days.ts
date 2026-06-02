import { defineAchievement } from '../define.js';
import { progressFromStat } from '../stat-progress.js';

/**
 * Progress achievement: cumulative 5 days in the top 3. Reads
 * `game_player_stats.daysInTopThree`.
 */
export default defineAchievement({
  key: 'podium-days',
  name: 'Podium',
  description: 'Be in the top 3 on 5 cumulative days.',
  rarity: 'uncommon',
  icon: 'medal',
  category: 'standing',
  target: 5,
  events: ['snapshot.recorded'],
  onEvent: progressFromStat('daysInTopThree'),
});
