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

export function useLogout() {
  const clear = useAuthStore((s) => s.clear);
  return () => {
    clear();
    queryClient.clear();
  };
}
