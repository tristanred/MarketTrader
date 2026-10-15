import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type React from 'react';

const apiFetch = vi.fn();
vi.mock('@/lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

import {
  adminLimitKeys,
  useAdminClearUserLimit,
  useAdminSetUserLimit,
  useAdminTopConsumers,
} from '@/api/admin/limits';

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidate };
}

describe('admin limits API hooks', () => {
  beforeEach(() => apiFetch.mockReset().mockResolvedValue({}));

  it('PUTs an override to the user-scoped path and invalidates limits and the user detail', async () => {
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useAdminSetUserLimit(), { wrapper });

    await result.current.mutateAsync({
      userId: 'u1',
      key: 'gamesCreated',
      value: 4,
      note: 'colleague',
    });

    expect(apiFetch).toHaveBeenCalledWith('/admin/users/u1/limits/gamesCreated', {
      method: 'PUT',
      body: { value: 4, note: 'colleague' },
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: adminLimitKeys.all });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'users', 'detail', 'u1'] });
  });

  it('DELETEs an override', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useAdminClearUserLimit(), { wrapper });

    await result.current.mutateAsync({ userId: 'u1', key: 'trades' });

    expect(apiFetch).toHaveBeenCalledWith('/admin/users/u1/limits/trades', { method: 'DELETE' });
  });

  it('requests top consumers with the chosen window and metric', async () => {
    apiFetch.mockResolvedValue({ window: '7d', metric: 'denials', rows: [] });
    const { wrapper } = setup();
    const { result } = renderHook(() => useAdminTopConsumers('7d', 'denials'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetch).toHaveBeenCalledWith('/admin/limits/top?window=7d&metric=denials');
  });
});
