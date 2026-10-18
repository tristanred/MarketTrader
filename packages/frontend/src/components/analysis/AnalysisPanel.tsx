import { X } from 'lucide-react';
import type { AnalysisVerdict, StockAnalysisResponse } from '@markettrader/shared';
import { cn, formatUSD } from '@/lib/utils';
import { RatingRail } from './RatingRail';
import {
  confidenceWord,
  type AnalysisErrorView,
  formatAnalyzedAgo,
  formatRemaining,
} from './analysisCopy';

const LABEL = 'text-[10px] font-semibold uppercase tracking-[0.14em] text-muted';

const VERDICT_TEXT: Record<AnalysisVerdict, string> = {
  BUY: 'text-gain',
  SELL: 'text-loss',
  HOLD: 'text-text-strong',
};

export interface AnalysisPanelProps {
  symbol: string;
  pending: boolean;
  /** What went wrong with the last request, or null. */
  error: AnalysisErrorView | null;
  result: StockAnalysisResponse | null;
  /**
   * Keeps bull and bear in one column at every width. The in-game dialog sits
   * in a viewport wide enough for `sm:` while being too narrow for two columns.
   */
  alwaysStacked: boolean;
  onDismiss: () => void;
  onRetry: () => void;
}

/**
 * The result of an Analyze click, inline in the quote view: a generating
 * state, an inline error (never a toast — it belongs to this action), or the
 * verdict with its rating rail, summary and bull/bear cases. Model output is
 * rendered as plain text only.
 */
export function AnalysisPanel({
  symbol,
  pending,
  error,
  result,
  alwaysStacked,
  onDismiss,
  onRetry,
}: AnalysisPanelProps) {
  const analysis = result?.analysis;
  return (
    <section
      aria-label={`${symbol} analysis`}
      className="rounded-md border border-hairline-strong bg-panel p-4"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className={LABEL}>Analysis</div>
        <div className="flex items-center gap-2">
          {analysis && !pending && !error && (
            <span
              className="text-[11px] text-muted"
              title={new Date(analysis.generatedAt).toLocaleString()}
            >
              {formatAnalyzedAgo(analysis.generatedAt)}
            </span>
          )}
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss analysis"
            className="-mr-1 inline-flex h-6 w-6 items-center justify-center rounded-chip text-muted hover:bg-hairline hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>

      {pending ? (
        <div className="space-y-3">
          <RatingRail verdict={null} pending className="w-full sm:w-64" />
          <p role="status" className="text-sm text-muted">
            Analyzing {symbol}… this can take up to a minute.
          </p>
        </div>
      ) : error ? (
        <ErrorBody view={error} onRetry={onRetry} />
      ) : analysis && result ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <div>
              <div
                className={cn(
                  'font-mono text-[28px] font-bold leading-none tracking-tight',
                  VERDICT_TEXT[analysis.verdict],
                )}
              >
                {analysis.verdict}
              </div>
              <div
                className="mt-1.5 text-xs text-muted"
                title={`Confidence ${analysis.confidence}/100`}
              >
                {confidenceWord(analysis.confidence)} confidence
              </div>
            </div>
            <RatingRail verdict={analysis.verdict} className="w-full sm:w-64" />
          </div>

          <p className="max-w-[68ch] text-sm leading-[1.55] text-text">{analysis.summary}</p>

          <div
            data-testid="analysis-cases"
            className={cn('grid grid-cols-1 gap-4', !alwaysStacked && 'sm:grid-cols-2')}
          >
            <CaseList
              title="Bull case"
              glyph="▲"
              glyphClass="text-gain"
              points={analysis.bullPoints}
            />
            <CaseList
              title="Bear case"
              glyph="▼"
              glyphClass="text-loss"
              points={analysis.bearPoints}
            />
          </div>

          <div className="space-y-0.5 border-t border-hairline-strong pt-3 text-[11px] leading-relaxed text-muted">
            <p>
              AI-generated from market data at{' '}
              <span className="font-mono tabular-nums">{formatUSD(analysis.priceAtAnalysis)}</span>.
              Not financial advice.
            </p>
            <FooterMeta model={analysis.reportedModel} remaining={formatRemaining(result.usage)} />
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ErrorBody({ view, onRetry }: { view: AnalysisErrorView; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p role="alert" className="max-w-[68ch] text-sm text-text">
        {view.message}
      </p>
      {view.retryable && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-7 items-center rounded-chip border border-hairline-strong px-2.5 text-xs font-medium text-accent hover:bg-accent-bg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          Try again
        </button>
      )}
    </div>
  );
}

function CaseList({
  title,
  glyph,
  glyphClass,
  points,
}: {
  title: string;
  glyph: string;
  glyphClass: string;
  points: string[];
}) {
  return (
    <div>
      <div className={cn(LABEL, 'mb-2')}>{title}</div>
      <ul className="space-y-1.5">
        {points.map((point, i) => (
          <li key={i} className="flex gap-2 text-sm leading-snug text-text">
            <span
              aria-hidden
              className={cn('shrink-0 font-mono text-[10px] leading-5', glyphClass)}
            >
              {glyph}
            </span>
            <span>{point}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FooterMeta({ model, remaining }: { model: string | null; remaining: string | null }) {
  const parts = [model === null ? null : `Model: ${model}`, remaining].filter(
    (p): p is string => p !== null,
  );
  if (parts.length === 0) return null;
  return <p className="break-words">{parts.join(' · ')}</p>;
}
