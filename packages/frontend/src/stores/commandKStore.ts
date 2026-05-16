import { create } from 'zustand';

/**
 * When the arena mounts, it registers a `setSelectedSymbol` here so the
 * AppShell-level overlay can write the chosen symbol back into the
 * SelectedSymbolContext without navigating. The arena clears it on
 * unmount.
 */
type ArenaSelectSetter = (symbol: string) => void;

interface CommandKState {
  /** Whether the cmd+k overlay is currently visible. */
  open: boolean;
  /** Opens the overlay. Named `open$` because `open` is the state field. */
  open$: () => void;
  /** Closes the overlay. */
  close: () => void;
  /** Flips the open state. Wired to the cmd+k / ctrl+k keyboard shortcut. */
  toggle: () => void;
  /**
   * Setter the arena registers so the overlay can write back into
   * SelectedSymbolContext instead of navigating. `null` when no arena is
   * mounted.
   */
  arenaSelect: ArenaSelectSetter | null;
  setArenaSelect: (fn: ArenaSelectSetter | null) => void;
}

/**
 * Zustand store backing the global cmd+k symbol-search overlay. Separated
 * from the React component so any component can open the overlay (the
 * pinned search panel does this via click) without prop-drilling.
 */
export const useCommandKStore = create<CommandKState>((set) => ({
  open: false,
  open$: () => set({ open: true }),
  close: () => set({ open: false }),
  toggle: () => set((s) => ({ open: !s.open })),
  arenaSelect: null,
  setArenaSelect: (fn) => set({ arenaSelect: fn }),
}));
