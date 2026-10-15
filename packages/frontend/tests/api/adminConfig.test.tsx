import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type React from 'react';

const apiFetch = vi.fn();
vi.mock('@/lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

import { useAdminResetConfig, useAdminSetConfig } from '@/api/admin/config';
import { adminLimitKeys } from '@/api/admin/limits';

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidate };
}

// A LIMIT_* or LIMITS_* edit changes the policy, the privileged-IP verdict and
// every effective max the limits views show.
describe('admin config API hooks', () => {
  beforeEach(() =>
    apiFetch.mockReset().mockResolvedValue({ key: 'LIMITS_PRIVILEGED_CIDRS', value: '203.0.113.0/24' }),
  );

  it('refreshes the limits views after saving an option', async () => {
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useAdminSetConfig(), { wrapper });
    await result.current.mutateAsync({ key: 'LIMITS_PRIVILEGED_CIDRS', value: '203.0.113.0/24' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: adminLimitKeys.all });
  });

  it('refreshes the limits views after resetting an option', async () => {
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useAdminResetConfig(), { wrapper });
    await result.current.mutateAsync('LIMITS_PRIVILEGED_CIDRS');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: adminLimitKeys.all });
  });
});
