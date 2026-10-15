import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  AdminLimitOverrideEntry,
  AdminLimitPolicy,
  AdminSetUserLimitRequest,
  AdminTopConsumersResponse,
  AdminUserLimitsResponse,
  LimitKey,
} from '@markettrader/shared';
import { apiFetch } from '@/lib/api';
import { adminUserKeys } from '@/api/admin/users';

export type TopWindow = AdminTopConsumersResponse['window'];
export type TopMetric = AdminTopConsumersResponse['metric'];

/** React Query keys for the admin limits views. Every mutation invalidates `all`. */
export const adminLimitKeys = {
  all: ['admin', 'limits'] as const,
  policy: () => [...adminLimitKeys.all, 'policy'] as const,
  top: (range: TopWindow, metric: TopMetric) =>
    [...adminLimitKeys.all, 'top', range, metric] as const,
  overrides: () => [...adminLimitKeys.all, 'overrides'] as const,
  user: (userId: string) => [...adminLimitKeys.all, 'user', userId] as const,
};

/** GET the limit policy and the caller's IP as the server sees it. */
export function useAdminLimitPolicy() {
  return useQuery({
    queryKey: adminLimitKeys.policy(),
    queryFn: () => apiFetch<AdminLimitPolicy>('/admin/limits/policy'),
  });
}

/** GET the heaviest users and IPs by request count or by limit denials. */
export function useAdminTopConsumers(range: TopWindow, metric: TopMetric) {
  return useQuery({
    queryKey: adminLimitKeys.top(range, metric),
    queryFn: () =>
      apiFetch<AdminTopConsumersResponse>(`/admin/limits/top?window=${range}&metric=${metric}`),
  });
}

/** GET every per-user override currently in force. */
export function useAdminLimitOverrides() {
  return useQuery({
    queryKey: adminLimitKeys.overrides(),
    queryFn: () => apiFetch<AdminLimitOverrideEntry[]>('/admin/limits/overrides'),
  });
}

/** GET one user's effective limits, usage, registration IP siblings, and recent activity. */
export function useAdminUserLimits(userId: string) {
  return useQuery({
    queryKey: adminLimitKeys.user(userId),
    queryFn: () => apiFetch<AdminUserLimitsResponse>(`/admin/users/${userId}/limits`),
    enabled: !!userId,
  });
}

interface UserLimitTarget {
  userId: string;
  key: LimitKey;
}

function invalidateAfterWrite(qc: QueryClient, userId: string) {
  void qc.invalidateQueries({ queryKey: adminLimitKeys.all });
  void qc.invalidateQueries({ queryKey: adminUserKeys.detail(userId) });
}

/** PUT a per-user override; it replaces the global value (multipliers do not apply to it). */
export function useAdminSetUserLimit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, key, ...body }: UserLimitTarget & AdminSetUserLimitRequest) =>
      apiFetch<unknown>(`/admin/users/${userId}/limits/${key}`, { method: 'PUT', body }),
    onSuccess: (_data, { userId }) => invalidateAfterWrite(qc, userId),
  });
}

/** DELETE a per-user override so the global value applies again. */
export function useAdminClearUserLimit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, key }: UserLimitTarget) =>
      apiFetch<unknown>(`/admin/users/${userId}/limits/${key}`, { method: 'DELETE' }),
    onSuccess: (_data, { userId }) => invalidateAfterWrite(qc, userId),
  });
}
