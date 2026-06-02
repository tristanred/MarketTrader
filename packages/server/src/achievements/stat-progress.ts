import { eq } from 'drizzle-orm';
import { schema } from '../db/index.js';
import type { AchievementContext } from './define.js';
import type { DomainEvent } from '../events/types.js';

/** Integer columns of `game_player_stats` that a progress achievement can mirror. */
type StatColumn = {
  [K in keyof typeof schema.gamePlayerStats._.columns]: (typeof schema.gamePlayerStats._.columns)[K] extends {
    dataType: 'number';
  }
    ? K
    : never;
}[keyof typeof schema.gamePlayerStats._.columns];

/** The subset of domain events whose payload carries a `gamePlayerId`. */
type PlayerScopedEvent = Extract<DomainEvent, { gamePlayerId: string }>;

/**
 * Builds an `onEvent` handler for the common "progress mirrors a single
 * `game_player_stats` integer column" achievement shape: read the column for
 * the event's player, and set progress to it (no-op until the stats row
 * exists). Used by the ~10 pure-progress definitions so the identical
 * select-guard-setProgress block lives in one place.
 *
 * The handler accepts any player-scoped event; the achievement's own `events`
 * array (validated by {@link defineAchievement}) constrains which actually fire.
 */
export function progressFromStat(
  column: StatColumn,
): (event: PlayerScopedEvent, ctx: AchievementContext) => Promise<void> {
  return async (event, ctx) => {
    const [stats] = await ctx.db
      .select({ value: schema.gamePlayerStats[column] })
      .from(schema.gamePlayerStats)
      .where(eq(schema.gamePlayerStats.gamePlayerId, event.gamePlayerId))
      .limit(1);
    if (!stats) return;
    await ctx.setProgress(event.gamePlayerId, stats.value ?? 0);
  };
}
