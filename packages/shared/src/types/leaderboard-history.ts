/**
 * Valid `range` values for `GET /games/:id/leaderboard/history`. Each
 * keyword maps to a window of time relative to "now":
 * - `1d`  — last 24 hours
 * - `5d`  — last 5 days
 * - `10d` — last 10 days
 * - `all` — clamped to game.startDate (or game.endDate for ended games)
 */
export type LeaderboardHistoryRange = '1d' | '5d' | '10d' | 'all';

/** A single point on one player's portfolio-value timeline. */
export interface LeaderboardHistoryPoint {
  /** ISO 8601 timestamp the snapshot was captured. */
  t: string;
  /** Total portfolio value (cash + holdings at market price) at `t`. */
  v: number;
  /** 1-based rank within the game at `t` (denormalised when written). */
  r: number;
}

/** All snapshot points for one player in one game over the requested range. */
export interface LeaderboardHistorySeries {
  playerId: string;
  username: string;
  /** Oldest-to-newest. May be empty for a player with no snapshots in range. */
  points: LeaderboardHistoryPoint[];
}

/** Response shape for `GET /games/:id/leaderboard/history`. */
export interface LeaderboardHistoryResponse {
  range: LeaderboardHistoryRange;
  /** ISO 8601 start of the returned window (game start, or now - range). */
  startedAt: string;
  /** ISO 8601 end of the returned window (now, or game end if ended). */
  endedAt: string;
  series: LeaderboardHistorySeries[];
}
