import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type React from 'react';
import type { StockAnalysisStatus } from '@markettrader/shared';

const apiFetch = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetch(...args) };
});

import { ApiError } from '@/lib/api';
import { stockAnalysisKeys, useAnalyzeStock, useStockAnalysisStatus } from '@/api/stock-analysis';
import { response, status, usage } from '../components/analysis/fixtures';

function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper, invalidate };
}

describe('stock analysis API hooks', () => {
  beforeEach(() => {
    apiFetch.mockReset();
  });

  it('fetches the status for a symbol', async () => {
    apiFetch.mockResolvedValue(status());
    const { wrapper } = setup();
    const { result } = renderHook(() => useStockAnalysisStatus('BRK-B'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetch).toHaveBeenCalledWith('/stocks/BRK-B/analysis/status');
  });

  it('does not fetch the status when disabled', () => {
    const { wrapper } = setup();
    renderHook(() => useStockAnalysisStatus('AAPL', { enabled: false }), { wrapper });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('polls a blocked status so the button re-enables on its own, and only then', async () => {
    apiFetch.mockResolvedValue(status({ available: false }));
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useStockAnalysisStatus('AAPL'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const query = qc.getQueryCache().find({ queryKey: stockAnalysisKeys.status('AAPL') })!;
    const interval = (query.options as { refetchInterval: (q: typeof query) => number | false })
      .refetchInterval;
    expect(interval(query)).toBe(60_000);

    qc.setQueryData(stockAnalysisKeys.status('AAPL'), status({ available: false, cached: true }));
    expect(interval(query)).toBe(false);
    qc.setQueryData(stockAnalysisKeys.status('AAPL'), status());
    expect(interval(query)).toBe(false);
  });

  it('POSTs with no body, so no JSON Content-Type is sent', async () => {
    apiFetch.mockResolvedValue(response());
    const { wrapper } = setup();
    const { result } = renderHook(() => useAnalyzeStock('AAPL'), { wrapper });
    await result.current.mutateAsync();
    expect(apiFetch).toHaveBeenCalledWith('/stocks/AAPL/analysis', { method: 'POST' });
  });

  it('writes the new usage into every cached status and marks this symbol cached', async () => {
    const newUsage = usage({ used: 4, remaining: 6 });
    apiFetch.mockResolvedValue(response({ usage: newUsage }));
    const { qc, wrapper } = setup();
    qc.setQueryData(stockAnalysisKeys.status('AAPL'), status());
    qc.setQueryData(stockAnalysisKeys.status('MSFT'), status());

    const { result } = renderHook(() => useAnalyzeStock('AAPL'), { wrapper });
    await result.current.mutateAsync();

    const aapl = qc.getQueryData<StockAnalysisStatus>(stockAnalysisKeys.status('AAPL'));
    const msft = qc.getQueryData<StockAnalysisStatus>(stockAnalysisKeys.status('MSFT'));
    expect(aapl).toMatchObject({ cached: true, usage: newUsage });
    expect(msft).toMatchObject({ cached: false, usage: newUsage });
  });

  it('does not invent a status entry that was never fetched', async () => {
    apiFetch.mockResolvedValue(response());
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useAnalyzeStock('AAPL'), { wrapper });
    await result.current.mutateAsync();
    expect(qc.getQueryData(stockAnalysisKeys.status('AAPL'))).toBeUndefined();
  });

  it('refetches statuses after a refusal so the button reflects it', async () => {
    apiFetch.mockRejectedValue(
      new ApiError(503, { error: 'x', code: 'ANALYSIS_UNAVAILABLE' }, '503 Service Unavailable'),
    );
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useAnalyzeStock('AAPL'), { wrapper });
    await expect(result.current.mutateAsync()).rejects.toBeInstanceOf(ApiError);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: stockAnalysisKeys.statusAll });
  });
});
