import { useMemo } from 'react';
import type {
  LeaderboardEntry,
  LeaderboardHistoryResponse,
  LeaderboardHistorySeries,
} from '@markettrader/shared';
import { Panel, PanelHeader } from '@/components/panel';
import { colorForPlayer } from '@/components/charts/portfolio-colors';
import { delta24hPct } from '@/components/game/arena/LeaderboardPanel';
import { cn } from '@/lib/utils';

export interface StandingsTableProps {
  entries: LeaderboardEntry[];
  history: LeaderboardHistoryResponse;
  startingBalance: number;
  currentUserId: string | null;
}

interface DerivedStats {
  peakRank: number | null;
  bestDayPct: number | null;
  worstDayPct: number | null;
}

function deriveStats(series: LeaderboardHistorySeries | undefined): DerivedStats {
  if (!series || series.points.length === 0) {
    return { peakRank: null, bestDayPct: null, worstDayPct: null };
  }
  let peakRank = series.points[0]!.r;
  let bestDayPct: number | null = null;
  let worstDayPct: number | null = null;
  for (let i = 1; i < series.points.length; i++) {
    const a = series.points[i - 1]!;
    const b = series.points[i]!;
    if (b.r < peakRank) peakRank = b.r;
    if (a.v <= 0) continue;
    const pct = ((b.v - a.v) / a.v) * 100;
    if (bestDayPct === null || pct > bestDayPct) bestDayPct = pct;
    if (worstDayPct === null || pct < worstDayPct) worstDayPct = pct;
  }
  return { peakRank, bestDayPct, worstDayPct };
}

/**
 * Full standings table for the dedicated page. Columns beyond the basic
 * leaderboard are derived from the history payload (peak rank, best day,
 * worst day) — no extra API call needed.
 */
export function StandingsTable({
  entries,
  history,
  startingBalance,
  currentUserId,
}: StandingsTableProps) {
  const seriesByPlayer = useMemo(() => {
    const map = new Map<string, LeaderboardHistorySeries>();
    for (const s of history.series) map.set(s.playerId, s);
    return map;
  }, [history.series]);

  return (
    <Panel>
      <PanelHeader
        right={
          <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted">
            VALUE · Δ24H · PEAK · BEST · WORST
          </span>
        }
      >
        Full standings
      </PanelHeader>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <Th className="w-10">#</Th>
              <Th>Player</Th>
              <Th align="right">Value</Th>
              <Th align="right">P&amp;L</Th>
              <Th align="right">Δ24h</Th>
              <Th align="right">Cash</Th>
              <Th align="right">Peak rank</Th>
              <Th align="right">Best day</Th>
              <Th align="right">Worst day</Th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const isMe = e.playerId === currentUserId;
              const series = seriesByPlayer.get(e.playerId);
              const d24 = delta24hPct(series?.points ?? []);
              const stats = deriveStats(series);
              const pnl = ((e.totalValue - startingBalance) / startingBalance) * 100;
              const color = colorForPlayer(e.playerId, isMe);
              return (
                <tr
                  key={e.playerId}
                  className={cn(
                    'border-b border-hairline last:border-b-0',
                    isMe && 'bg-accent-bg',
                  )}
                >
                  <Td className={cn(isMe && 'border-l-2 border-accent', 'tabular-nums')}>
                    {String(e.rank).padStart(2, '0')}
                  </Td>
                  <Td>
                    <span className="flex items-center gap-2">
                      <span
                        className="inline-block h-2 w-2 rounded-[2px]"
                        style={{ background: color }}
                        aria-hidden="true"
                      />
                      <span className={cn(isMe && 'text-text-strong')}>
                        {isMe ? `${e.username} (you)` : e.username}
                      </span>
                    </span>
                  </Td>
                  <Td align="right" mono>
                    ${e.totalValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </Td>
                  <Td align="right" mono tone={pnl}>
                    {fmtPct(pnl)}
                  </Td>
                  <Td align="right" mono tone={d24}>
                    {d24 == null ? '—' : fmtPct(d24)}
                  </Td>
                  <Td align="right" mono>
                    ${e.cashBalance.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </Td>
                  <Td align="right" mono>
                    {stats.peakRank == null ? '—' : `#${stats.peakRank}`}
                  </Td>
                  <Td align="right" mono tone={stats.bestDayPct}>
                    {stats.bestDayPct == null ? '—' : fmtPct(stats.bestDayPct)}
                  </Td>
                  <Td align="right" mono tone={stats.worstDayPct}>
                    {stats.worstDayPct == null ? '—' : fmtPct(stats.worstDayPct)}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Th({
  children,
  align = 'left',
  className,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <th
      className={cn(
        'border-b border-hairline-strong px-2.5 py-2 font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-muted',
        align === 'right' && 'text-right',
        align === 'left' && 'text-left',
        className,
      )}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = 'left',
  mono,
  tone,
  className,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  mono?: boolean;
  tone?: number | null;
  className?: string;
}) {
  const toneClass =
    tone == null
      ? ''
      : tone > 0
        ? 'text-gain'
        : tone < 0
          ? 'text-loss'
          : 'text-muted';
  return (
    <td
      className={cn(
        'px-2.5 py-2 text-xs',
        align === 'right' && 'text-right',
        mono && 'font-mono',
        toneClass,
        className,
      )}
    >
      {children}
    </td>
  );
}

function fmtPct(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${Math.abs(n).toFixed(2)}%`;
}
