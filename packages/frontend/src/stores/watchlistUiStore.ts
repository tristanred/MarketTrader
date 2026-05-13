import { create } from 'zustand';

/**
 * Per-session UI state for the Watchlist tab in HoldingsSidebar.
 * `selectedWatchlistId` is the dropdown's current pick; `editMode` toggles
 * the search-autocomplete editor (pencil → DONE) over the table view.
 * Both reset on reload — server data is the source of truth for lists.
 */
interface WatchlistUiState {
  selectedWatchlistId: string | null;
  editMode: boolean;
  setSelected: (id: string | null) => void;
  setEditMode: (on: boolean) => void;
}

export const useWatchlistUiStore = create<WatchlistUiState>((set) => ({
  selectedWatchlistId: null,
  editMode: false,
  setSelected: (selectedWatchlistId) => set({ selectedWatchlistId, editMode: false }),
  setEditMode: (editMode) => set({ editMode }),
}));
