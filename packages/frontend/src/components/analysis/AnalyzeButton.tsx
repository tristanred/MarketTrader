import { Loader2, Sparkles } from 'lucide-react';
import type { StockAnalysisStatus } from '@markettrader/shared';
import { formatRetryAfter } from '@/lib/limits';
import { cn } from '@/lib/utils';
import { analyzeButtonState, type AnalyzeButtonState } from './analysisCopy';

export interface AnalyzeButtonProps {
  /** Null while the status is loading or failed to load; the button stays hidden until known. */
  status: StockAnalysisStatus | null;
  /** This view's own request is running; disables the button. */
  pending: boolean;
  onAnalyze: () => void;
  className?: string;
}

function captionFor(state: AnalyzeButtonState): string | null {
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

/**
 * The quote view's "Analyze" affordance plus a one-line caption about the
 * caller's allowance. Renders nothing until the status is known, or when the
 * server has no LLM configured.
 */
export function AnalyzeButton({ status, pending, onAnalyze, className }: AnalyzeButtonProps) {
  if (!status || !status.enabled) return null;

  const state = analyzeButtonState(status, pending);
  const caption = captionFor(state);
  const blocked = state.kind === 'unavailable' || state.kind === 'exhausted';
  const busy = pending || state.kind === 'generating';

  return (
    <div className={cn('flex flex-col items-end gap-1', className)}>
      <button
        type="button"
        onClick={onAnalyze}
        disabled={pending || blocked}
        aria-busy={busy || undefined}
        className={cn(
          'inline-flex h-7 items-center gap-1.5 rounded-chip border border-hairline-strong px-2.5 text-xs font-medium text-accent transition-colors',
          'hover:bg-accent-bg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent',
          // Pending keeps the cyan so the click reads as accepted, not refused.
          busy
            ? 'bg-accent-bg'
            : 'disabled:cursor-not-allowed disabled:border-disabled-border disabled:bg-disabled-bg disabled:text-disabled-fg',
        )}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
        )}
        {busy ? 'Analyzing…' : 'Analyze'}
      </button>
      {caption && <span className="text-[10px] leading-tight text-muted">{caption}</span>}
    </div>
  );
}
