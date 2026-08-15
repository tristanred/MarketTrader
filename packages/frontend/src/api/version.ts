import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type { VersionInfo } from '@markettrader/shared';

/**
 * Fetches the API server's build stamp for the /version page.
 *
 * `skipAuth` because this is a diagnostic surface: it has to keep working
 * when the session is broken, and a stale token would otherwise drag the
 * request through the refresh-retry path for an endpoint that never 401s.
 */
export function useServerVersion() {
  return useQuery({
    queryKey: ['version'],
    queryFn: () => apiFetch<VersionInfo>('/version', { skipAuth: true }),
    staleTime: 0,
    retry: 1,
  });
}
