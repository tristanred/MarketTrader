import { defineAchievement } from '../define.js';
import { progressFromStat } from '../stat-progress.js';

const mirrorLosingSellsToday = progressFromStat('losingSellsToday');

/**
 * Counter achievement: close 3 losing positions in a single UTC day.
 * Reads `game_player_stats.losingSellsToday`, maintained by the
 * position-close stats rollup with a UTC day-rollover branch.
 */
export default defineAchievement({
  key: 'tax-loss-harvester',
  name: 'Tax Loss Harvester',
  description: 'Close 3 losing positions in a single UTC day.',
  rarity: 'uncommon',
  icon: 'receipt',
  category: 'trading',
  target: 3,
  events: ['position.closed'],
  async onEvent(event, ctx) {
    // Only winning-vs-losing matters here; the stat itself counts the losers.
    if (event.realizedPnl >= 0) return;
    await mirrorLosingSellsToday(event, ctx);
  },
});
