import { Loader2, Sparkles } from 'lucide-react';
import type { StockAnalysisStatus } from '@markettrader/shared';
import { cn } from '@/lib/utils';
import { analyzeButtonCaption, analyzeButtonState } from './analysisCopy';
import { CHIP_BUTTON_CLASS } from './styles';

export interface AnalyzeButtonProps {
  /** Null while the status is loading or failed to load; the button stays hidden until known. */
  status: StockAnalysisStatus | null;
  /** This view's own request is running; disables the button. */
  pending: boolean;
  onAnalyze: () => void;
  className?: string;
}

/**
 * The quote view's "Analyze" affordance plus a one-line caption about the
 * caller's allowance. Renders nothing until the status is known, or when the
 * server has no LLM configured.
 */
export function AnalyzeButton({ status, pending, onAnalyze, className }: AnalyzeButtonProps) {
  if (!status || !status.enabled) return null;

  const state = analyzeButtonState(status, pending);
  const caption = analyzeButtonCaption(state);
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
          CHIP_BUTTON_CLASS,
          'gap-1.5 transition-colors',
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
