import { useMutation } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { queryClient } from '@/lib/queryClient';
import type { AuthResponse, LoginRequest, RegisterRequest } from '@markettrader/shared';

export function useRegister() {
  const setSession = useAuthStore((s) => s.setSession);
  return useMutation({
    mutationFn: (body: RegisterRequest) =>
      apiFetch<AuthResponse>('/auth/register', { method: 'POST', body, skipAuth: true }),
    onSuccess: (data) => {
      setSession(data.token, data.user);
    },
  });
}

export function useLogin() {
  const setSession = useAuthStore((s) => s.setSession);
  return useMutation({
    mutationFn: (body: LoginRequest) =>
      apiFetch<AuthResponse>('/auth/login', { method: 'POST', body, skipAuth: true }),
    onSuccess: (data) => {
      setSession(data.token, data.user);
    },
  });
}

/**
 * Returns an async logout function. Posts to `/auth/logout` to clear the
 * server-side refresh cookie before clearing in-memory session state. The
 * server call is best-effort — a network failure must not strand the user
 * with stale state, so we swallow the error and clear locally anyway.
 */
export function useLogout() {
  const clear = useAuthStore((s) => s.clear);
  return async () => {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch {
      /* clear locally even if the server call failed */
    }
    clear();
    queryClient.clear();
  };
}
