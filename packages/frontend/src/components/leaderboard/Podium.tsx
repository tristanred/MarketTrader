import type { LeaderboardEntry } from '@markettrader/shared';
import { cn } from '@/lib/utils';

export interface PodiumProps {
  /** Leaderboard entries sorted by rank ascending. */
  entries: LeaderboardEntry[];
  startingBalance: number;
  className?: string;
}

/**
 * Top-3 visualisation rendered above the race chart. Subtle medal glows
 * (radial-gradient via inline CSS variable) keep the page warm without
 * leaning on icons or shiny gradients — both would clash with the rest
 * of the terminal-style chrome.
 */
export function Podium({ entries, startingBalance, className }: PodiumProps) {
  const top3 = entries.slice(0, 3);
  if (top3.length === 0) return null;
  // Visual order: 2nd left, 1st centre, 3rd right.
  const ordered: Array<LeaderboardEntry | undefined> = [top3[1], top3[0], top3[2]];
  const places: Array<{ name: string; key: 'first' | 'second' | 'third'; label: string }> = [
    { name: '2ND · SILVER', key: 'second', label: '2ND' },
    { name: '1ST · GOLD', key: 'first', label: '1ST' },
    { name: '3RD · BRONZE', key: 'third', label: '3RD' },
  ];

  return (
    <div className={cn('grid grid-cols-3 items-end gap-2', className)}>
      {ordered.map((e, i) => {
        const place = places[i]!;
        if (!e) return <div key={place.key} />;
        const pnl = ((e.totalValue - startingBalance) / startingBalance) * 100;
        const isFirst = place.key === 'first';
        return (
          <PodiumStep key={place.key} variant={place.key} label={place.name} prominent={isFirst}>
            <div className={cn('font-semibold text-text-strong', isFirst ? 'text-base' : 'text-sm')}>
              {e.username}
            </div>
            <div className={cn('mt-2 font-mono', isFirst ? 'text-[13px]' : 'text-xs')}>
              ${e.totalValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </div>
            <div className={cn('font-mono text-[11px]', pnl >= 0 ? 'text-gain' : 'text-loss')}>
              {pnl >= 0 ? '+' : '−'}
              {Math.abs(pnl).toFixed(2)}%
            </div>
          </PodiumStep>
        );
      })}
    </div>
  );
}

function PodiumStep({
  variant,
  label,
  prominent,
  children,
}: {
  variant: 'first' | 'second' | 'third';
  label: string;
  prominent: boolean;
  children: React.ReactNode;
}) {
  const glow: Record<typeof variant, string> = {
    first: 'rgba(245, 158, 11, 0.22)',
    second: 'rgba(167, 139, 250, 0.18)',
    third: 'rgba(244, 114, 182, 0.16)',
  } as const;
  const labelColor: Record<typeof variant, string> = {
    first: '#f59e0b',
    second: '#a78bfa',
    third: '#f472b6',
  } as const;
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-panel border border-hairline-strong bg-panel p-3',
        prominent && 'pb-4',
      )}
      style={{
        backgroundImage: `radial-gradient(120% 60% at 50% -10%, ${glow[variant]} 0%, transparent 60%)`,
      }}
    >
      <div
        className="font-mono text-[10px] uppercase tracking-[0.18em]"
        style={{ color: labelColor[variant] }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}
