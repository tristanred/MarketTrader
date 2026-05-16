import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type { AdminAuditEntry, AdminAuditTargetType } from '@markettrader/shared';

export interface AdminAuditQuery {
  action?: string;
  targetType?: AdminAuditTargetType;
  targetId?: string;
  adminUserId?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

export const adminAuditKeys = {
  all: ['admin', 'audit'] as const,
  list: (q: AdminAuditQuery) => [...adminAuditKeys.all, 'list', q] as const,
};

function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

export function useAdminAudit(query: AdminAuditQuery) {
  return useQuery({
    queryKey: adminAuditKeys.list(query),
    queryFn: () =>
      apiFetch<{ entries: AdminAuditEntry[]; total: number }>(`/admin/audit${qs({ ...query })}`),
  });
}
