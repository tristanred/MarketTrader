import { and, eq, isNotNull, ne } from 'drizzle-orm';
import { defineAchievement } from '../define.js';
import { schema } from '../../db/index.js';

const SELF_KEY = 'achievement-horse';

/**
 * Meta-achievement: unlock when the player has acquired more than half of
 * the achievements available in this game. "Available" means enabled in
 * this game (game flag + global disable list + per-game overrides). This
 * achievement does not count itself in the denominator.
 *
 * Triggers off other unlocks via the `achievement.unlocked` domain event.
 * Self-triggering is guarded so unlocking Horse does not re-fire the
 * threshold check.
 */
export default defineAchievement({
  key: SELF_KEY,
  name: 'Achievement Horse',
  description:
    'Unlock more than half of the achievements available in this game.',
  rarity: 'legendary',
  icon: 'rosette',
  category: 'meta',
  target: 1,
  events: ['achievement.unlocked'],
  async onEvent(event, ctx) {
    if (event.achievementKey === SELF_KEY) return;

    const existing = await ctx.getProgress(event.gamePlayerId);
    if (existing.unlockedAt !== null) return;

    const enabledOthers: string[] = [];
    for (const key of ctx.allAchievementKeys()) {
      if (key === SELF_KEY) continue;
      if (await ctx.isAchievementEnabled(event.gameId, key)) {
        enabledOthers.push(key);
      }
    }
    if (enabledOthers.length === 0) return;

    const enabledSet = new Set(enabledOthers);

    const unlockedRows = await ctx.db
      .select({ key: schema.achievementProgress.achievementKey })
      .from(schema.achievementProgress)
      .where(
        and(
          eq(schema.achievementProgress.gameId, event.gameId),
          eq(schema.achievementProgress.gamePlayerId, event.gamePlayerId),
          isNotNull(schema.achievementProgress.unlockedAt),
          ne(schema.achievementProgress.achievementKey, SELF_KEY),
        ),
      );

    let unlockedCount = 0;
    for (const row of unlockedRows) {
      if (enabledSet.has(row.key)) unlockedCount += 1;
    }

    if (unlockedCount * 2 > enabledOthers.length) {
      await ctx.unlock(event.gamePlayerId);
    }
  },
});
