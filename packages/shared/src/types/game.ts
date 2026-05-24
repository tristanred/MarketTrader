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
  /**
   * When true, the trade UI exposes SELL SHORT and BUY TO COVER actions.
   * Backend rejects short-direction trades when this is false. Defaults to
   * false on game creation.
   */
  allowShortSelling: boolean;
  /** When true, limit orders may be placed. Server rejects with 409 LIMIT_ORDERS_DISABLED otherwise. */
  allowLimitOrders: boolean;
  /** When true, stop / stop-limit orders may be placed. Server rejects with 409 STOP_ORDERS_DISABLED otherwise. */
  allowStopOrders: boolean;
  /** When true, bracket orders may be placed. Server rejects with 409 BRACKET_ORDERS_DISABLED otherwise. */
  allowBracketOrders: boolean;
  /** When true, `timeInForce='gtc'` is accepted. Server rejects with 409 GTC_DISABLED otherwise. */
  allowGTC: boolean;
  /**
   * When false, the achievement engine ignores every event for this game.
   * Defaults to true on game creation.
   */
  achievementsEnabled: boolean;
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
  /** Defaults to false when omitted. */
  allowShortSelling?: boolean;
  /** Defaults to false when omitted. */
  allowLimitOrders?: boolean;
  /** Defaults to false when omitted. */
  allowStopOrders?: boolean;
  /** Defaults to false when omitted. */
  allowBracketOrders?: boolean;
  /** Defaults to false when omitted. */
  allowGTC?: boolean;
  /** Defaults to true when omitted. */
  achievementsEnabled?: boolean;
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
