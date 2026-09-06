/**
 * A user-owned watchlist with its symbols. Watchlists are global to a user
 * (not scoped to a game) and may contain symbols the user does not hold.
 */
export interface Watchlist {
  id: string;
  name: string;
  /** Symbols on the list, uppercased, in the order they were added. */
  symbols: string[];
  /**
   * Free-form user notes keyed by symbol. Sparse — a symbol with no note (or
   * a blank one) is absent rather than mapped to `''`. Omitted entirely when
   * no symbol on the list carries a note.
   */
  notes?: Record<string, string>;
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

/**
 * Body of `PATCH /watchlists/:id/items/:symbol`. A blank or whitespace-only
 * `note` clears the existing one — there is no separate delete verb.
 */
export interface SetWatchlistNoteRequest {
  /** At most 1000 characters. */
  note: string;
}
