import { defineAchievement } from '../define.js';
import { progressFromStat } from '../stat-progress.js';

/**
 * Progress achievement: be rank 1 for 3 consecutive UTC days. Reads the
 * canonical counter from `game_player_stats.consecutiveDaysAtRankOne`, which
 * is advanced inside the snapshot transaction by `applySnapshotStats`.
 */
export default defineAchievement({
  key: 'reigning-champ',
  name: 'Reigning Champ',
  description: 'Be rank 1 on 3 consecutive days.',
  rarity: 'rare',
  icon: 'star',
  category: 'standing',
  target: 3,
  events: ['snapshot.recorded'],
  onEvent: progressFromStat('consecutiveDaysAtRankOne'),
});
