/**
 * Lifecycle state of a game, derived from `startDate`/`endDate` at read time.
 * - `pending` — not yet started (before `startDate`)
 * - `active`  — trading window is open
 * - `ended`   — past `endDate` or manually closed
 */
export type GameStatus = 'pending' | 'active' | 'ended';

/** Full game entity as returned by the API. All dates are ISO 8601 strings. */
export interface Game {
  id: string;
  name: string;
  /** ISO 8601. Trading opens when the server clock reaches this value. */
  startDate: string;
  /** ISO 8601. Trading closes when the server clock reaches this value. */
  endDate: string;
  /** Virtual USD each player starts with. Default: $100,000. */
  startingBalance: number;
  status: GameStatus;
  /** ID of the user who created the game. */
  createdBy: string;
  createdAt: string;
}

/** POST /games request body. */
export interface CreateGameRequest {
  name: string;
  /** ISO 8601 datetime string. Must be before `endDate`. */
  startDate: string;
  /** ISO 8601 datetime string. Must be after `startDate`. */
  endDate: string;
  /** Virtual USD starting balance. Must be positive. */
  startingBalance: number;
}

/** A single player's rank entry as returned in the game leaderboard. */
export interface LeaderboardEntry {
  /** The player's userId (matches {@link Game.createdBy}). */
  playerId: string;
  username: string;
  /** Cash currently held (does not include the market value of open positions). */
  cashBalance: number;
  /** Cash balance + current portfolio market value. */
  totalValue: number;
  /** 1-based rank by descending `totalValue`. */
  rank: number;
}

/** Game detail response from `GET /games/:id` — includes the current leaderboard. */
export interface GameWithLeaderboard extends Game {
  leaderboard: LeaderboardEntry[];
}
