import { create } from 'zustand';

interface CommandKState {
  /** Whether the cmd+k overlay is currently visible. */
  open: boolean;
  /** Opens the overlay. Named `open$` because `open` is the state field. */
  open$: () => void;
  /** Closes the overlay. */
  close: () => void;
  /** Flips the open state. Wired to the cmd+k / ctrl+k keyboard shortcut. */
  toggle: () => void;
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
}));
