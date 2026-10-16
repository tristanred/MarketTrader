import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type { AdminConfigEntry, AdminConfigResponse, AdminSetConfigRequest } from '@markettrader/shared';
import { adminLimitKeys } from '@/api/admin/limits';

/** React Query keys for the admin configuration list. */
export const adminConfigKeys = {
  all: ['admin', 'config'] as const,
};

/** GET every host configuration option. */
export function useAdminConfig() {
  return useQuery({
    queryKey: adminConfigKeys.all,
    queryFn: () => apiFetch<AdminConfigResponse>('/admin/config'),
  });
}

function replaceEntry(qc: QueryClient, next: AdminConfigEntry) {
  qc.setQueryData<AdminConfigResponse>(adminConfigKeys.all, (prev) =>
    prev ? { entries: prev.entries.map((e) => (e.key === next.key ? next : e)) } : prev,
  );
  // Limit options feed the policy, the privileged-IP banner and every effective
  // max on the limits views, which the server resolves live from config.
  void qc.invalidateQueries({ queryKey: adminLimitKeys.all });
}

/** PUT an override for a live option; patches the cached list and refetches the limits views. */
export function useAdminSetConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string } & AdminSetConfigRequest) =>
      apiFetch<AdminConfigEntry>(`/admin/config/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: { value },
      }),
    onSuccess: (next) => replaceEntry(qc, next),
  });
}

/** DELETE an override so the environment value applies again; refetches the limits views too. */
export function useAdminResetConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) =>
      apiFetch<AdminConfigEntry>(`/admin/config/${encodeURIComponent(key)}`, { method: 'DELETE' }),
    onSuccess: (next) => replaceEntry(qc, next),
  });
}
