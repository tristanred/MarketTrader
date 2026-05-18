/**
 * Public, unauthenticated game leaderboard payload used by the login /
 * register pages to render "top tournaments in progress" without the
 * caller needing an auth token. Trimmed compared to the authenticated
 * {@link import('./game.js').LeaderboardEntry} — no `playerId`, no
 * `cashBalance` — to avoid leaking anything beyond display names and
 * scores.
 */
export interface FeaturedLeaderboardEntry {
  rank: number;
  username: string;
  /** Cash + portfolio market value, in USD. */
  totalValue: number;
  /** (totalValue - startingBalance) / startingBalance × 100. */
  pnlPct: number;
}

/**
 * One active game and a truncated leaderboard, as returned by
 * `GET /public/featured-games`.
 */
export interface FeaturedGame {
  id: string;
  name: string;
  /** 1-indexed day within the game window. */
  dayCurrent: number;
  /** Inclusive total number of days the game spans. */
  dayTotal: number;
  /** Top players in descending `totalValue` order. */
  leaderboard: FeaturedLeaderboardEntry[];
}
