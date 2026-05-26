import { defineAchievement } from '../define.js';

/**
 * Boolean unlock for finishing dead last in a game with at least 3 players.
 * The cut-off avoids awarding the achievement in trivial 2-player games where
 * coming "last" is just the inverse of {@link champion}.
 */
export default defineAchievement({
  key: 'wooden-spoon',
  name: 'Wooden Spoon',
  description: 'Finish last in a game with 3 or more players.',
  rarity: 'uncommon',
  icon: 'utensils',
  category: 'finale',
  target: 1,
  events: ['game.ended'],
  async onEvent(event, ctx) {
    if (event.finalRanking.length < 3) return;
    const lastRank = event.finalRanking.reduce(
      (max, entry) => (entry.rank > max ? entry.rank : max),
      0,
    );
    for (const entry of event.finalRanking) {
      if (entry.rank === lastRank) {
        await ctx.unlock(entry.gamePlayerId);
      }
    }
  },
});
