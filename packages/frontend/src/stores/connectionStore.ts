import { create } from 'zustand';

/**
 * Health of one live socket. `idle` means no socket is mounted for that
 * channel — a game socket outside a game page, for instance — and is excluded
 * from the aggregate rather than treated as healthy.
 */
export type ConnectionStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'offline';

/** `game` is the per-game socket, `global` the app-wide `/ws/live` one. */
export type ConnectionChannel = 'game' | 'global';

interface ConnectionState {
  game: ConnectionStatus;
  global: ConnectionStatus;
  /**
   * Incremented by {@link ConnectionState.requestRetry}. Socket hooks watch it
   * so a user-driven retry can revive a connection that gave up, without the
   * store holding references to live sockets.
   */
  retryNonce: number;
  setStatus: (channel: ConnectionChannel, status: ConnectionStatus) => void;
  requestRetry: () => void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  game: 'idle',
  global: 'idle',
  retryNonce: 0,
  setStatus: (channel, status) => set({ [channel]: status } as Pick<ConnectionState, ConnectionChannel>),
  requestRetry: () => set((s) => ({ retryNonce: s.retryNonce + 1 })),
}));

const SEVERITY: Record<ConnectionStatus, number> = {
  idle: 0,
  live: 1,
  connecting: 2,
  reconnecting: 3,
  offline: 4,
};

/** Worst status across the mounted channels — what the chrome should show. */
export function selectConnectionStatus(s: {
  game: ConnectionStatus;
  global: ConnectionStatus;
}): ConnectionStatus {
  return SEVERITY[s.game] > SEVERITY[s.global] ? s.game : s.global;
}
