/**
 * Visual tier / scarcity. Drives the rarity color, halo intensity, and
 * sort order in the UI. Code-defined in `defineAchievement()`; never
 * stored in the database (definitions are the source of truth).
 */
export type AchievementRarity =
  | 'common'
  | 'uncommon'
  | 'rare'
  | 'epic'
  | 'legendary';

/**
 * Code-defined achievement metadata as exposed to the API. Definitions live
 * in the server's `achievements/definitions/` directory; this DTO is the
 * read-only projection sent to clients.
 */
export interface AchievementDefinitionDTO {
  /** Stable identifier matching `achievement_progress.achievement_key`. */
  key: string;
  name: string;
  description: string;
  /** Optional grouping label for UI presentation (e.g. 'trading', 'social'). */
  category?: string;
  /** Visual tier, drives rarity color in the UI. */
  rarity: AchievementRarity;
  /** Lucide icon name in kebab-case (e.g. 'flame', 'trending-up'). */
  icon: string;
  /** Numeric target. Boolean achievements use `target: 1`. */
  target: number;
  /** Effective enabled state for the queried game (after game flag + global setting + per-game override). */
  enabled: boolean;
}

/** Per-player progress on a single achievement, scoped to one game. */
export interface AchievementProgressDTO {
  achievementKey: string;
  gamePlayerId: string;
  progress: number;
  target: number;
  /** ISO 8601 timestamp. Null while progress < target. */
  unlockedAt: string | null;
}

/**
 * Admin-facing variant of {@link AchievementProgressDTO}. The `orphaned`
 * flag marks rows whose key is no longer registered with the engine, so
 * the admin UI can surface them for cleanup.
 */
export interface AdminAchievementProgressRow extends AchievementProgressDTO {
  orphaned: boolean;
}

/**
 * Shape of `GET /admin/games/:id/achievements`. Includes the full registry
 * (no hiding) plus every progress row in the game — orphans included.
 */
export interface AdminGameAchievementsView {
  definitions: AchievementDefinitionDTO[];
  rows: AdminAchievementProgressRow[];
}

/** Shape of `GET /admin/achievements` — definitions with their global enabled state. */
export interface AdminGlobalAchievementsView {
  definitions: AchievementDefinitionDTO[];
}

/**
 * Pushed to all players in a game the moment another player unlocks an
 * achievement. Fields are denormalised so clients can render a toast without
 * a follow-up fetch. `replayed` distinguishes connect-time catch-up frames
 * from live unlocks — clients use it to adjust the eyebrow copy.
 */
export interface WsAchievementUnlockedEvent {
  event: 'achievement_unlocked';
  data: {
    gamePlayerId: string;
    achievementKey: string;
    name: string;
    description: string;
    rarity: AchievementRarity;
    icon: string;
    unlockedAt: string;
    /** True when sent from the WS connect-time replay loop. */
    replayed?: boolean;
  };
}
