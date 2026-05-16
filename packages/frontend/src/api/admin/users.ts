import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type {
  AdminListUsersResponse,
  AdminUserDetail,
  AdminUpdateUserRequest,
  AdminResetPasswordRequest,
  AdminListUserPlayersResponse,
} from '@markettrader/shared';

export const adminUserKeys = {
  all: ['admin', 'users'] as const,
  list: (q: AdminListUsersQuery) => [...adminUserKeys.all, 'list', q] as const,
  detail: (id: string) => [...adminUserKeys.all, 'detail', id] as const,
};

export interface AdminListUsersQuery {
  q?: string;
  limit?: number;
  offset?: number;
  sort?: 'createdAt' | 'username';
}

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

export function useAdminUsers(query: AdminListUsersQuery) {
  return useQuery({
    queryKey: adminUserKeys.list(query),
    queryFn: () => apiFetch<AdminListUsersResponse>(`/admin/users${qs({ ...query })}`),
  });
}

export function useAdminUser(userId: string) {
  return useQuery({
    queryKey: adminUserKeys.detail(userId),
    queryFn: () => apiFetch<AdminUserDetail>(`/admin/users/${userId}`),
    enabled: !!userId,
  });
}

export function useAdminUserPlayers(userId: string) {
  return useQuery({
    queryKey: [...adminUserKeys.detail(userId), 'players'] as const,
    queryFn: () => apiFetch<AdminListUserPlayersResponse>(`/admin/users/${userId}/players`),
    enabled: !!userId,
  });
}

export function useAdminUpdateUser(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AdminUpdateUserRequest) =>
      apiFetch<void>(`/admin/users/${userId}`, { method: 'PATCH', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminUserKeys.all });
    },
  });
}

export function useAdminDeleteUser(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ force }: { force?: boolean } = {}) =>
      apiFetch<void>(`/admin/users/${userId}${force ? '?force=true' : ''}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminUserKeys.all });
    },
  });
}

export function useAdminResetPassword(userId: string) {
  return useMutation({
    mutationFn: (body: AdminResetPasswordRequest) =>
      apiFetch<void>(`/admin/users/${userId}/reset-password`, { method: 'POST', body }),
  });
}

export function useAdminAddUserGroup(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (groupName: string) =>
      apiFetch<void>(`/admin/users/${userId}/groups/${groupName}`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminUserKeys.all });
    },
  });
}

export function useAdminRemoveUserGroup(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (groupName: string) =>
      apiFetch<void>(`/admin/users/${userId}/groups/${groupName}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminUserKeys.all });
    },
  });
}
