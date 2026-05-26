import { eq } from 'drizzle-orm';
import { defineAchievement } from '../define.js';
import { schema } from '../../db/index.js';

/**
 * Boolean unlock for the player(s) who were ranked 1 at the very first
 * portfolio snapshot AND ranked 1 at the game's end. Reads the earliest
 * `portfolio_snapshots` row for each candidate (final-rank-1 entry) and
 * confirms its rank was 1.
 */
export default defineAchievement({
  key: 'wire-to-wire',
  name: 'Wire to Wire',
  description: 'Lead the leaderboard from the first snapshot through the final standings.',
  rarity: 'legendary',
  icon: 'flag',
  category: 'finale',
  target: 1,
  events: ['game.ended'],
  async onEvent(event, ctx) {
    for (const entry of event.finalRanking) {
      if (entry.rank !== 1) continue;
      const [first] = await ctx.db
        .select({ rank: schema.portfolioSnapshots.rank })
        .from(schema.portfolioSnapshots)
        .where(eq(schema.portfolioSnapshots.gamePlayerId, entry.gamePlayerId))
        .orderBy(schema.portfolioSnapshots.capturedAt)
        .limit(1);
      if (first?.rank === 1) {
        await ctx.unlock(entry.gamePlayerId);
      }
    }
  },
});
