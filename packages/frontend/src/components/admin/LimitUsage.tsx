import type { LimitBasis } from '@markettrader/shared';
import { cn } from '@/lib/utils';

const BASIS_STYLE: Record<LimitBasis, { label: string; className: string }> = {
  base: { label: 'Base', className: 'border border-hairline-strong text-text' },
  probation: { label: 'Probation', className: 'bg-sky-500/15 text-sky-700 dark:text-sky-400' },
  override: { label: 'Override', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  admin: { label: 'Admin', className: 'bg-accent-bg text-accent' },
  disabled: {
    label: 'Limits off',
    className: 'border border-hairline-strong text-muted-foreground',
  },
};

/** Why a user has the limit they have: the resolver's `basis`. */
export function LimitBasisBadge({ basis }: { basis: LimitBasis }) {
  const style = BASIS_STYLE[basis];
  return (
    <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', style.className)}>
      {style.label}
    </span>
  );
}

/** `used / max` with a bar; amber from 80%, red at the limit. `used` is null where nothing is countable. */
export function LimitUsageBar({ used, max }: { used: number | null; max: number | null }) {
  if (used === null) return <span className="text-xs text-muted-foreground">—</span>;
  if (max === null) return <span className="font-mono text-xs">{used} used</span>;
  const ratio = Math.min(1, used / max);
  const tone = used >= max ? 'bg-destructive' : ratio >= 0.8 ? 'bg-amber-500' : 'bg-primary';
  return (
    <div className="w-32 space-y-1">
      <div className="font-mono text-xs">
        {used} / {max}
      </div>
      <div
        className="h-1.5 rounded bg-muted"
        role="progressbar"
        aria-label="Usage"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={used}
      >
        <div className={cn('h-full rounded', tone)} style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}
