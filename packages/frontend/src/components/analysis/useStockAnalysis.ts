import { useCallback, useEffect, useRef, useState } from 'react';
import type { StockAnalysisResponse, StockAnalysisStatus } from '@markettrader/shared';
import { isAnalysisPending, useAnalyzeStock, useStockAnalysisStatus } from '@/api/stock-analysis';
import {
  ANALYSIS_FAILED_VIEW,
  ANALYSIS_SLOW_VIEW,
  describeAnalysisError,
  describeAnalysisFailure,
  type AnalysisErrorView,
} from './analysisCopy';

/** How long a click waits on a background generation before giving up. */
export const ANALYSIS_WAIT_CAP_MS = 240_000;

/**
 * Where this view's Analyze click stands. `waiting` polls the status for a
 * generation that outlived its POST; `joined` means the click found one
 * already running rather than starting it. `startedAt` is the click time.
 */
export type AnalysisPhase =
  | { kind: 'idle' }
  | { kind: 'requesting'; startedAt: number }
  | { kind: 'waiting'; startedAt: number; since: number; joined: boolean }
  | { kind: 'done'; result: StockAnalysisResponse }
  | { kind: 'failed'; view: AnalysisErrorView };

type WaitingPhase = Extract<AnalysisPhase, { kind: 'waiting' }>;

/** What a waiting click does about a fresh status: POST, fail with this copy, or keep waiting (null). */
type WaitStep = { kind: 'post' } | { kind: 'fail'; view: AnalysisErrorView } | null;

/**
 * Decides a waiting click's next move from a status read after it started
 * waiting. A cached result is fetched with a (free) POST; a failure is shown
 * only if it happened after the click, else the click's own outcome applies.
 */
export function nextWaitStep(phase: WaitingPhase, status: StockAnalysisStatus): WaitStep {
  if (status.cached) return { kind: 'post' };
  if (status.generating) return null;
  const failure = status.lastFailure;
  // failedAt is server time and startedAt client time; a skewed clock only
  // costs the specific copy, since the fallback is the generic failure.
  if (failure && Date.parse(failure.failedAt) >= phase.startedAt) {
    return { kind: 'fail', view: describeAnalysisFailure(failure) };
  }
  // The generation the click joined had already ended; this click starts one.
  if (phase.joined) return { kind: 'post' };
  return { kind: 'fail', view: ANALYSIS_FAILED_VIEW };
}

const IDLE: AnalysisPhase = { kind: 'idle' };

/**
 * The whole Analyze flow for one symbol: POST, and on a 202 poll the status
 * until it is cached — then POST again, a free cache hit — or reports a
 * failure, capped at {@link ANALYSIS_WAIT_CAP_MS}. Nothing runs until `start`;
 * a generation the status reports on load is never joined without a click.
 */
export function useStockAnalysis(symbol: string) {
  const [state, setState] = useState<{ symbol: string; phase: AnalysisPhase }>({
    symbol,
    phase: IDLE,
  });
  // Adjusting state during render, so a symbol change never shows the old result for a frame.
  if (state.symbol !== symbol) setState({ symbol, phase: IDLE });
  const phase = state.symbol === symbol ? state.phase : IDLE;

  const status = useStockAnalysisStatus(symbol, { waiting: phase.kind === 'waiting' });
  const { data, dataUpdatedAt } = status;
  const { mutateAsync } = useAnalyzeStock(symbol);

  // Bumped on every start, dismiss, symbol change and unmount; a callback from
  // an older run sees a different number and drops its result.
  const runRef = useRef(0);
  useEffect(
    () => () => {
      runRef.current += 1;
    },
    [symbol],
  );

  const settle = useCallback(
    (run: number, next: AnalysisPhase) => {
      if (runRef.current === run) setState({ symbol, phase: next });
    },
    [symbol],
  );

  const post = useCallback(
    (run: number, startedAt: number) => {
      settle(run, { kind: 'requesting', startedAt });
      mutateAsync().then(
        (res) => {
          if (isAnalysisPending(res)) {
            settle(run, { kind: 'waiting', startedAt, since: Date.now(), joined: false });
          } else {
            settle(run, { kind: 'done', result: res });
          }
        },
        // A 409 is never about this symbol — the server joins a same-symbol request to
        // the running generation — so it shows "still running" rather than polling
        // this symbol's status, which would read as a failure and invite a retry loop.
        (err: unknown) => settle(run, { kind: 'failed', view: describeAnalysisError(err) }),
      );
    },
    [mutateAsync, settle],
  );

  const start = useCallback(() => {
    runRef.current += 1;
    const run = runRef.current;
    const now = Date.now();
    if (data?.generating && !data.cached) {
      settle(run, { kind: 'waiting', startedAt: now, since: now, joined: true });
    } else {
      post(run, now);
    }
  }, [data, post, settle]);

  const dismiss = useCallback(() => {
    runRef.current += 1;
    setState({ symbol, phase: IDLE });
  }, [symbol]);

  useEffect(() => {
    if (phase.kind !== 'waiting' || !data || dataUpdatedAt < phase.since) return;
    const run = runRef.current;
    const step = nextWaitStep(phase, data);
    if (step?.kind === 'post') post(run, phase.startedAt);
    else if (step?.kind === 'fail') settle(run, { kind: 'failed', view: step.view });
  }, [phase, data, dataUpdatedAt, post, settle]);

  useEffect(() => {
    if (phase.kind !== 'waiting') return;
    const run = runRef.current;
    const timer = setTimeout(
      () => settle(run, { kind: 'failed', view: ANALYSIS_SLOW_VIEW }),
      Math.max(0, phase.startedAt + ANALYSIS_WAIT_CAP_MS - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [phase, settle]);

  return {
    status,
    phase,
    /** This view's own request is in flight or waiting on a background generation. */
    busy: phase.kind === 'requesting' || phase.kind === 'waiting',
    start,
    dismiss,
  };
}
