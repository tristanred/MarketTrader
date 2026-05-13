/**
 * A user-owned watchlist with its symbols. Watchlists are global to a user
 * (not scoped to a game) and may contain symbols the user does not hold.
 */
export interface Watchlist {
  id: string;
  name: string;
  /** Symbols on the list, uppercased, in the order they were added. */
  symbols: string[];
  /** ISO 8601 timestamp. */
  createdAt: string;
}

export interface CreateWatchlistRequest {
  name: string;
}

export interface RenameWatchlistRequest {
  name: string;
}

export interface AddWatchlistSymbolRequest {
  symbol: string;
}
