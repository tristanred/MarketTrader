import type {
  AnalysisErrorBody,
  AnalysisErrorCode,
  AnalysisUsage,
  StockAnalysisStatus,
} from '@markettrader/shared';
import { ApiError } from '@/lib/api';
import { extractApiMessage } from '@/lib/extractApiMessage';
import { formatLimitMessage, formatRetryAfter, isLimitExceeded, secondsUntil } from '@/lib/limits';

/** What the panel shows for a failed request, and whether a retry can help. */
export interface AnalysisErrorView {
  message: string;
  retryable: boolean;
}

const ANALYSIS_ERROR_CODES: ReadonlySet<string> = new Set<AnalysisErrorCode>([
  'ANALYSIS_DISABLED',
  'ANALYSIS_UNAVAILABLE',
  'ANALYSIS_CAPACITY',
  'ANALYSIS_IN_PROGRESS',
  'ANALYSIS_FAILED',
  'ANALYSIS_TIMEOUT',
]);

function analysisErrorBodyOf(err: unknown): AnalysisErrorBody | null {
  if (!(err instanceof ApiError)) return null;
  const body = err.body;
  if (typeof body !== 'object' || body === null) return null;
  const code = (body as Record<string, unknown>)['code'];
  if (typeof code !== 'string' || !ANALYSIS_ERROR_CODES.has(code)) return null;
  return body as AnalysisErrorBody;
}

/** Shown when a generation failed with no more specific reason; a retry is free. */
export const ANALYSIS_FAILED_VIEW: AnalysisErrorView = {
  message: "Couldn't generate an analysis. This didn't use one of your analyses.",
  retryable: true,
};

/** Shown when the status poll gives up waiting on a background generation. */
export const ANALYSIS_SLOW_VIEW: AnalysisErrorView = {
  message: 'The analysis is taking longer than usual. Try again in a few minutes.',
  retryable: true,
};

/**
 * Maps an analysis error body — from a refused POST, or the `lastFailure` a
 * background generation left on the status — to panel copy, by its `code`.
 */
export function describeAnalysisFailure(body: AnalysisErrorBody): AnalysisErrorView {
  switch (body.code) {
    case 'ANALYSIS_UNAVAILABLE':
    case 'ANALYSIS_CAPACITY': {
      const retry = body.retryAfterSeconds;
      const when =
        typeof retry === 'number' && retry > 0 ? ` Try again ${formatRetryAfter(retry)}.` : '';
      return { message: `Analysis is temporarily unavailable.${when}`, retryable: false };
    }
    case 'ANALYSIS_DISABLED':
      return { message: 'Analysis is turned off on this server.', retryable: false };
    case 'ANALYSIS_IN_PROGRESS':
      return { message: 'An analysis you started is still running.', retryable: false };
    case 'ANALYSIS_FAILED':
    case 'ANALYSIS_TIMEOUT':
      return ANALYSIS_FAILED_VIEW;
  }
}

/**
 * Maps a failed `POST /stocks/:symbol/analysis` to panel copy. Branches on the
 * body's `code` rather than the status, since one status carries several causes.
 */
export function describeAnalysisError(err: unknown): AnalysisErrorView {
  if (isLimitExceeded(err)) return { message: formatLimitMessage(err.body), retryable: false };
  const body = analysisErrorBodyOf(err);
  if (!body) return { message: extractApiMessage(err), retryable: false };
  return describeAnalysisFailure(body);
}

/** Low 0–39, Moderate 40–69, High 70–100 — a word, because an LLM's number isn't that precise. */
export function confidenceWord(confidence: number): 'Low' | 'Moderate' | 'High' {
  if (confidence < 40) return 'Low';
  if (confidence < 70) return 'Moderate';
  return 'High';
}

/** "Analyzed just now", "Analyzed 12 min ago", "Analyzed 3 h ago", "Analyzed 2 d ago". */
export function formatAnalyzedAgo(iso: string, now = Date.now()): string {
  const mins = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (!Number.isFinite(mins) || mins < 1) return 'Analyzed just now';
  if (mins < 60) return `Analyzed ${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Analyzed ${hours} h ago`;
  return `Analyzed ${Math.floor(hours / 24)} d ago`;
}

/** "7 of 10 left today", or null when the allowance is unlimited. */
export function formatRemaining(usage: AnalysisUsage): string | null {
  if (usage.limit === null || usage.remaining === null) return null;
  return `${usage.remaining} of ${usage.limit} left today`;
}

/**
 * The Analyze button's state, in precedence order. `pending` is this view's own
 * request; `generating` is one the status reports but this view didn't start.
 */
export type AnalyzeButtonState =
  | { kind: 'pending' }
  | { kind: 'cached' }
  | { kind: 'generating' }
  | { kind: 'unavailable'; retryInSeconds: number | null }
  | { kind: 'exhausted'; resetInSeconds: number | null }
  | { kind: 'ready'; caption: string | null };

/** Derives the button state from a loaded status; see the spec's state table. */
export function analyzeButtonState(
  status: StockAnalysisStatus,
  pending: boolean,
  now = Date.now(),
): AnalyzeButtonState {
  if (pending) return { kind: 'pending' };
  // A cached result is served even while the upstream is paused or the allowance is spent.
  if (status.cached) return { kind: 'cached' };
  // Started before this view loaded (a reload mid-generation, another tab). Shown
  // as busy but left clickable: a click waits on it instead of starting another.
  if (status.generating) return { kind: 'generating' };
  if (!status.available) {
    return { kind: 'unavailable', retryInSeconds: secondsUntil(status.retryAt, now) };
  }
  if (status.usage.remaining === 0) {
    return { kind: 'exhausted', resetInSeconds: secondsUntil(status.usage.nextSlotAt, now) };
  }
  return { kind: 'ready', caption: formatRemaining(status.usage) };
}

/** The one-line caption under the Analyze button, or null when it shows none. */
export function analyzeButtonCaption(state: AnalyzeButtonState): string | null {
  switch (state.kind) {
    case 'pending':
    case 'generating':
      return null;
    case 'cached':
      return 'Already analyzed — free to view';
    case 'unavailable':
      return state.retryInSeconds === null
        ? 'Analysis unavailable'
        : `Analysis unavailable · try again ${formatRetryAfter(state.retryInSeconds)}`;
    case 'exhausted':
      return state.resetInSeconds === null
        ? 'Daily limit reached'
        : `Daily limit reached · resets ${formatRetryAfter(state.resetInSeconds)}`;
    case 'ready':
      return state.caption;
  }
}
