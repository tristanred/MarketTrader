import { Panel, PanelHeader, PanelBody } from '@/components/panel';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/utils';

export interface LeaderboardEntry {
  playerId: string;
  username: string;
  rank: number;
  totalValue: number;
  cashBalance: number;
}

export interface LeaderboardPanelProps {
  entries: LeaderboardEntry[];
  startingBalance: number;
  className?: string;
}

/**
 * Left-column arena panel showing all players ranked by portfolio value.
 * The current user's row is marked with `data-current-user` and a 2px
 * accent left border so it stays findable as ranks shift.
 */
export function LeaderboardPanel({ entries, startingBalance, className }: LeaderboardPanelProps) {
  const userId = useAuthStore((s) => s.user?.id);

  return (
    <Panel className={className}>
      <PanelHeader
        right={
          <span className="rounded-chip bg-accent-bg px-1.5 py-0.5 text-[9px] tracking-[0.14em] text-accent">
            <span aria-hidden="true">● </span>LIVE
          </span>
        }
      >
        Leaderboard
      </PanelHeader>
      <PanelBody>
        {entries.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted">No players yet.</p>
        ) : (
          <ul className="space-y-0.5">
            {entries.map((e) => {
              const pnl = startingBalance > 0
                ? ((e.totalValue - startingBalance) / startingBalance) * 100
                : 0;
              const isMe = e.playerId === userId;
              return (
                <li
                  key={e.playerId}
                  data-current-user={isMe ? 'true' : undefined}
                  className={cn(
                    'grid grid-cols-[24px_1fr_auto_auto] items-baseline gap-3 py-1 text-xs',
                    isMe && 'relative pl-2 bg-accent-bg/40 before:absolute before:left-0 before:top-1 before:bottom-1 before:w-0.5 before:bg-accent',
                  )}
                >
                  <span className="font-mono text-[10px] text-muted">
                    {String(e.rank).padStart(2, '0')}
                  </span>
                  <span className={cn('font-medium', isMe ? 'text-text-strong' : 'text-text')}>
                    {e.username}
                  </span>
                  <span className="font-mono text-text">{formatUsd(e.totalValue)}</span>
                  <span className={cn('font-mono', pnl >= 0 ? 'text-gain' : 'text-loss')}>
                    {formatPnl(pnl)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </PanelBody>
    </Panel>
  );
}

function formatUsd(n: number): string {
  return `$${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n)}`;
}
function formatPnl(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${Math.abs(n).toFixed(2)}%`;
}
