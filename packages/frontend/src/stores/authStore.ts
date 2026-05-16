import { create } from 'zustand';
import type { AuthUser } from '@markettrader/shared';

/**
 * Session state for the authenticated user. Token is held in memory only —
 * the long-lived refresh token lives in an HttpOnly cookie set by the server,
 * and the access token is restored on page load by calling /auth/refresh.
 */
interface AuthState {
  token: string | null;
  user: AuthUser | null;
  /** True until the initial /auth/refresh attempt on mount has completed. */
  ready: boolean;
  setSession: (token: string, user: AuthUser) => void;
  clear: () => void;
  setReady: (ready: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  ready: false,
  setSession: (token, user) => set({ token, user }),
  clear: () => set({ token: null, user: null }),
  setReady: (ready) => set({ ready }),
}));

/** True iff the current user belongs to the `admin` group. */
export function useIsAdmin(): boolean {
  return useAuthStore((s) => s.user?.groups?.includes('admin') ?? false);
}
