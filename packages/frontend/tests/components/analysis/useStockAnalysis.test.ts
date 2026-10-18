import { describe, it, expect } from 'vitest';
import type { AnalysisFailure } from '@markettrader/shared';
import { ANALYSIS_FAILED_VIEW, describeAnalysisFailure } from '@/components/analysis/analysisCopy';
import { nextWaitStep } from '@/components/analysis/useStockAnalysis';
import { status } from './fixtures';

const STARTED_AT = Date.parse('2026-10-17T12:00:00.000Z');

function waiting(joined: boolean) {
  return { kind: 'waiting', startedAt: STARTED_AT, since: STARTED_AT, joined } as const;
}

function failure(failedAt: number): AnalysisFailure {
  return {
    error: 'x',
    code: 'ANALYSIS_CAPACITY',
    retryAfterSeconds: 600,
    failedAt: new Date(failedAt).toISOString(),
  };
}

describe('nextWaitStep', () => {
  it.each([false, true])('POSTs for the cached result (joined: %s)', (joined) => {
    expect(nextWaitStep(waiting(joined), status({ cached: true }))).toEqual({ kind: 'post' });
  });

  it('prefers a cached result over a failure reported alongside it', () => {
    const s = status({ cached: true, lastFailure: failure(STARTED_AT + 1_000) });
    expect(nextWaitStep(waiting(false), s)).toEqual({ kind: 'post' });
  });

  it.each([false, true])('keeps waiting while the generation runs (joined: %s)', (joined) => {
    expect(nextWaitStep(waiting(joined), status({ generating: true }))).toBeNull();
  });

  it.each([
    ['after', STARTED_AT + 1_000],
    ['at', STARTED_AT],
  ])('shows the specific copy for a failure %s the click', (_, failedAt) => {
    const lastFailure = failure(failedAt);
    expect(nextWaitStep(waiting(false), status({ lastFailure }))).toEqual({
      kind: 'fail',
      view: describeAnalysisFailure(lastFailure),
    });
  });

  it('starts a generation when the joined one ended in a failure before the click', () => {
    const s = status({ lastFailure: failure(STARTED_AT - 60_000) });
    expect(nextWaitStep(waiting(true), s)).toEqual({ kind: 'post' });
  });

  it('starts a generation when the joined one ended with no failure recorded', () => {
    expect(nextWaitStep(waiting(true), status())).toEqual({ kind: 'post' });
  });

  it('shows the generic failure for a stale failure on a click that started the generation', () => {
    const s = status({ lastFailure: failure(STARTED_AT - 60_000) });
    expect(nextWaitStep(waiting(false), s)).toEqual({ kind: 'fail', view: ANALYSIS_FAILED_VIEW });
  });

  it('shows the generic failure when its own generation ended with nothing recorded', () => {
    expect(nextWaitStep(waiting(false), status())).toEqual({
      kind: 'fail',
      view: ANALYSIS_FAILED_VIEW,
    });
  });
});
