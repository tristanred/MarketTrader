import { defineAchievement } from '../define.js';
import { progressFromStat } from '../stat-progress.js';

/**
 * Progress achievement: trade 5 distinct symbols. Reads the canonical count
 * from `game_player_stats.distinctSymbolsTradedEver`, which is updated
 * synchronously inside the trade transaction by `applyTradeStats`.
 */
export default defineAchievement({
  key: 'sampler',
  name: 'Sampler',
  description: 'Trade 5 distinct symbols.',
  rarity: 'common',
  icon: 'shapes',
  category: 'trading',
  target: 5,
  events: ['trade.executed'],
  onEvent: progressFromStat('distinctSymbolsTradedEver'),
});
