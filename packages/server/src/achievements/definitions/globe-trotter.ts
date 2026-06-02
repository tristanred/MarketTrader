import { defineAchievement } from '../define.js';
import { progressFromStat } from '../stat-progress.js';

/**
 * Progress achievement: trade 15 distinct symbols. Reads the canonical count
 * from `game_player_stats.distinctSymbolsTradedEver`, which is updated
 * synchronously inside the trade transaction by `applyTradeStats`.
 */
export default defineAchievement({
  key: 'globe-trotter',
  name: 'Globe Trotter',
  description: 'Trade 15 distinct symbols.',
  rarity: 'uncommon',
  icon: 'globe',
  category: 'trading',
  target: 15,
  events: ['trade.executed'],
  onEvent: progressFromStat('distinctSymbolsTradedEver'),
});
