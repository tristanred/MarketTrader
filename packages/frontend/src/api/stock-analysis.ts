import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type {
  StockAnalysisPending,
  StockAnalysisResponse,
  StockAnalysisStatus,
} from '@markettrader/shared';

export const stockAnalysisKeys = {
  statusAll: ['stock-analysis', 'status'] as const,
  status: (symbol: string) => ['stock-analysis', 'status', symbol] as const,
  analyze: (symbol: string) => ['stock-analysis', 'analyze', symbol] as const,
};

/** Status poll while waiting on a generation that outlived its POST (a 202). */
const ANALYSIS_WAIT_POLL_MS = 2_500;
const BLOCKED_STATUS_POLL_MS = 60_000;

/** A POST answers 200 with the analysis, or 202 when the model is still working. */
export type AnalyzeStockResult = StockAnalysisResponse | StockAnalysisPending;

/** True for the 202 body; apiFetch hides the status code, so this goes by shape. */
export function isAnalysisPending(res: AnalyzeStockResult): res is StockAnalysisPending {
  return 'status' in res && res.status === 'generating';
}

/**
 * Whether the Analyze button should show, be enabled, and what its caption says.
 * `waiting` polls every {@link ANALYSIS_WAIT_POLL_MS} for the end of a generation.
 */
export function useStockAnalysisStatus(
  symbol: string,
  { enabled = true, waiting = false }: { enabled?: boolean; waiting?: boolean } = {},
) {
  return useQuery({
    queryKey: stockAnalysisKeys.status(symbol),
    queryFn: () =>
      apiFetch<StockAnalysisStatus>(`/stocks/${encodeURIComponent(symbol)}/analysis/status`),
    enabled: enabled && !!symbol,
    staleTime: 60_000,
    refetchInterval: (query) => {
      if (waiting) return ANALYSIS_WAIT_POLL_MS;
      // A blocked button has to notice the pause or the limit lifting on its own:
      // window-focus refetch is off app-wide.
      const s = query.state.data;
      const blocked = !!s && !s.cached && (!s.available || s.usage.remaining === 0);
      return blocked ? BLOCKED_STATUS_POLL_MS : false;
    },
  });
}

/**
 * Requests an analysis of `symbol` (a cached one when it exists). On success the
 * returned usage is written into every cached status, since the allowance is
 * per user rather than per symbol; a 202 marks this symbol's status generating.
 * On any failure the statuses are refetched, because a refusal usually means
 * the allowance or availability has moved.
 */
export function useAnalyzeStock(symbol: string) {
  const qc = useQueryClient();
  return useMutation({
    // Keyed by symbol so a symbol change resets the observer. Without a key,
    // react-query pushes the new render's options (and its closed-over symbol)
    // onto a still-pending mutation, and its result would be written to the
    // wrong symbol's status.
    mutationKey: stockAnalysisKeys.analyze(symbol),
    // No body: a JSON body would set Content-Type, which Fastify refuses when empty.
    mutationFn: () =>
      apiFetch<AnalyzeStockResult>(`/stocks/${encodeURIComponent(symbol)}/analysis`, {
        method: 'POST',
      }),
    onSuccess: async (res) => {
      qc.setQueriesData<StockAnalysisStatus>({ queryKey: stockAnalysisKeys.statusAll }, (old) =>
        old ? { ...old, usage: res.usage } : old,
      );
      const key = stockAnalysisKeys.status(symbol);
      if (isAnalysisPending(res)) {
        // A status read already in flight predates the 202 and would report
        // "not generating", which a waiting caller reads as a failure.
        await qc.cancelQueries({ queryKey: key });
        qc.setQueryData<StockAnalysisStatus>(key, (old) =>
          old ? { ...old, generating: true } : old,
        );
      } else {
        qc.setQueryData<StockAnalysisStatus>(key, (old) =>
          old ? { ...old, cached: true, generating: false } : old,
        );
      }
    },
    onError: () => {
      void qc.invalidateQueries({ queryKey: stockAnalysisKeys.statusAll });
    },
  });
}
