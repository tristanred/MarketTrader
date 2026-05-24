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
 * Pushed to all players in a game the moment another player unlocks an
 * achievement. Fields are denormalised so clients can render a toast without
 * a follow-up fetch.
 */
export interface WsAchievementUnlockedEvent {
  event: 'achievement_unlocked';
  data: {
    gamePlayerId: string;
    achievementKey: string;
    name: string;
    description: string;
    unlockedAt: string;
  };
}
