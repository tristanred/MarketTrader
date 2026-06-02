import { defineAchievement } from '../define.js';
import { progressFromStat } from '../stat-progress.js';

/**
 * Counter achievement: execute 20 trades in a single UTC day. Reads
 * `game_player_stats.tradesToday`, which the trade-stats rollup
 * maintains with a UTC day-rollover branch.
 */
export default defineAchievement({
  key: 'sir-this-is-a-wendys',
  name: "Sir, This Is a Wendy's",
  description: 'Execute 20 trades in a single UTC day.',
  rarity: 'legendary',
  icon: 'utensils-crossed',
  category: 'trading',
  target: 20,
  events: ['trade.executed'],
  onEvent: progressFromStat('tradesToday'),
});
