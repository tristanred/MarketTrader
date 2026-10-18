import type { AnalysisVerdict } from '@markettrader/shared';
import { cn } from '@/lib/utils';

const SEGMENTS: ReadonlyArray<{ verdict: AnalysisVerdict; label: string }> = [
  { verdict: 'SELL', label: 'Sell' },
  { verdict: 'HOLD', label: 'Hold' },
  { verdict: 'BUY', label: 'Buy' },
];

// Tailwind 3 can't put an opacity modifier on a var() colour, hence color-mix.
const LIT: Record<AnalysisVerdict, { text: string; fill: string }> = {
  BUY: {
    text: 'text-gain',
    fill: 'bg-[color:color-mix(in_srgb,var(--gain)_16%,transparent)] shadow-[inset_0_0_0_1px_var(--gain)]',
  },
  SELL: {
    text: 'text-loss',
    fill: 'bg-[color:color-mix(in_srgb,var(--loss)_16%,transparent)] shadow-[inset_0_0_0_1px_var(--loss)]',
  },
  // Neutral on purpose: amber would read as a warning and cyan as a link.
  HOLD: {
    text: 'text-text-strong',
    fill: 'bg-hairline-strong shadow-[inset_0_0_0_1px_var(--muted)]',
  },
};

export interface RatingRailProps {
  /** The lit segment; null while the analysis is being generated. */
  verdict: AnalysisVerdict | null;
  /** Sweeps a highlight along the rail while an analysis is generating. */
  pending?: boolean;
  className?: string;
}

/**
 * A three-segment Sell · Hold · Buy scale with the verdict lit, borrowed from
 * analyst-consensus bars. Decorative: the verdict word beside it carries the
 * accessible text, so the rail is hidden from assistive tech.
 */
export function RatingRail({ verdict, pending = false, className }: RatingRailProps) {
  return (
    <div
      aria-hidden
      data-testid="rating-rail"
      className={cn(
        'relative grid grid-cols-3 overflow-hidden rounded-chip border border-hairline-strong',
        className,
      )}
    >
      {SEGMENTS.map((seg, i) => {
        const lit = verdict === seg.verdict ? LIT[seg.verdict] : null;
        return (
          <div
            key={seg.verdict}
            data-lit={lit ? 'true' : undefined}
            className={cn(
              'relative flex h-8 items-center justify-center font-mono text-[11px] font-semibold uppercase tracking-[0.14em]',
              i > 0 && 'border-l border-hairline-strong',
              lit ? lit.text : 'text-muted',
            )}
          >
            {lit && <span className={cn('absolute inset-0 animate-rail-fill', lit.fill)} />}
            <span className="relative">{seg.label}</span>
          </div>
        );
      })}
      {pending && (
        <span
          data-testid="rating-rail-sweep"
          className="pointer-events-none absolute inset-y-0 left-0 w-1/3 animate-rail-sweep bg-gradient-to-r from-transparent via-[color:color-mix(in_srgb,var(--text-strong)_12%,transparent)] to-transparent"
        />
      )}
    </div>
  );
}
