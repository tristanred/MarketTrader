import { memo, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LeaderboardHistoryPoint, LeaderboardHistoryRange } from '@markettrader/shared';
import { Panel, PanelHeader, PanelBody } from '@/components/panel';
import { PortfolioSparkline } from '@/components/charts/PortfolioSparkline';
import { colorForPlayer } from '@/components/charts/portfolio-colors';
import { useLeaderboardHistory } from '@/api/leaderboard-history';
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
  gameId: string;
  entries: LeaderboardEntry[];
  startingBalance: number;
  /** When false, hides the `Full view ↗` link (e.g. on the dedicated page itself). */
  showFullViewLink?: boolean;
  /** Default range chip selection. */
  initialRange?: LeaderboardHistoryRange;
  className?: string;
}

const RANGE_OPTIONS: { key: LeaderboardHistoryRange; label: string }[] = [
  { key: '1d', label: '1D' },
  { key: '5d', label: '5D' },
  { key: '10d', label: '10D' },
  { key: 'all', label: 'ALL' },
];

const VISIBLE_ROWS = 10;
const SPARKLINE_MAX_POINTS = 60;

/**
 * Centre-column leaderboard. Defaults to showing the top 10 with the current
 * user pinned to the top regardless of rank. An expand widget at the foot
 * reveals the full field. Each row carries a 240×24 sparkline derived from
 * `GET /games/:id/leaderboard/history`. Sparklines refresh automatically on
 * every `leaderboard_update` WS event via the React Query invalidation in
 * `useGameSocket`.
 */
export function LeaderboardPanel({
  gameId,
  entries,
  startingBalance,
  showFullViewLink = true,
  initialRange = '5d',
  className,
}: LeaderboardPanelProps) {
  const userId = useAuthStore((s) => s.user?.id);
  const [range, setRange] = useState<LeaderboardHistoryRange>(initialRange);
  const [expanded, setExpanded] = useState(false);

  const history = useLeaderboardHistory(gameId, range, SPARKLINE_MAX_POINTS);

  const pointsByPlayer = useMemo(() => {
    const map = new Map<string, LeaderboardHistoryPoint[]>();
    for (const s of history.data?.series ?? []) {
      map.set(s.playerId, s.points);
    }
    return map;
  }, [history.data]);

  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => a.rank - b.rank),
    [entries],
  );

  const myEntry = userId
    ? sortedEntries.find((e) => e.playerId === userId) ?? null
    : null;
  const myPoints = myEntry ? pointsByPlayer.get(myEntry.playerId) ?? [] : [];

  const visibleEntries = expanded ? sortedEntries : sortedEntries.slice(0, VISIBLE_ROWS);
  const hiddenCount = Math.max(0, sortedEntries.length - VISIBLE_ROWS);
  const youAreHidden = !!myEntry && myEntry.rank > VISIBLE_ROWS;

  return (
    <Panel className={className}>
      <PanelHeader
        right={
          <span className="flex items-center gap-2">
            <RangeChips range={range} onChange={setRange} />
            {showFullViewLink ? <FullViewLink gameId={gameId} /> : null}
            <span className="rounded-chip bg-accent-bg px-1.5 py-0.5 text-[9px] tracking-[0.14em] text-accent">
              <span aria-hidden="true">● </span>LIVE
            </span>
          </span>
        }
      >
        Leaderboard
        <span className="ml-2 font-mono text-[10px] normal-case tracking-normal text-muted">
          · {expanded ? `${sortedEntries.length} of ${sortedEntries.length}` : `top ${Math.min(VISIBLE_ROWS, sortedEntries.length)} of ${sortedEntries.length}`}
        </span>
      </PanelHeader>

      <PanelBody className="px-0 py-0">
        {sortedEntries.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted">No players yet.</p>
        ) : (
          <>
            {/* Pinned "you" row — visible regardless of rank or expand state. */}
            {myEntry ? (
              <PinnedYouRow
                entry={myEntry}
                points={myPoints}
                startingBalance={startingBalance}
              />
            ) : null}

            <ColumnHeader />

            <ul className="divide-y divide-hairline">
              {visibleEntries.map((e) => (
                <LeaderboardRow
                  key={e.playerId}
                  entry={e}
                  points={pointsByPlayer.get(e.playerId) ?? []}
                  startingBalance={startingBalance}
                  isMe={e.playerId === userId}
                />
              ))}
            </ul>

            {hiddenCount > 0 ? (
              <ExpandFooter
                expanded={expanded}
                hiddenCount={hiddenCount}
                youAreHidden={youAreHidden}
                myRank={myEntry?.rank ?? null}
                onToggle={() => setExpanded((v) => !v)}
              />
            ) : null}
          </>
        )}
      </PanelBody>
    </Panel>
  );
}

function RangeChips({
  range,
  onChange,
}: {
  range: LeaderboardHistoryRange;
  onChange: (r: LeaderboardHistoryRange) => void;
}) {
  return (
    <span className="flex gap-1">
      {RANGE_OPTIONS.map((o) => {
        const active = o.key === range;
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.key)}
            className={cn(
              'rounded-chip px-1.5 py-0.5 font-mono text-[9px] tracking-[0.14em] transition-colors',
              active
                ? 'bg-accent-bg text-accent border border-accent'
                : 'border border-hairline-strong text-muted hover:text-text hover:border-text',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </span>
  );
}

function FullViewLink({ gameId }: { gameId: string }) {
  return (
    <Link
      to={`/games/${gameId}/leaderboard`}
      className="rounded-chip border border-accent px-1.5 py-0.5 font-mono text-[9px] tracking-[0.14em] text-accent hover:bg-accent-bg"
    >
      Full view ↗
    </Link>
  );
}

function ColumnHeader() {
  return (
    <div className="grid grid-cols-[28px_minmax(140px,1.4fr)_1fr_100px_70px_70px_18px] items-center gap-3 border-b border-hairline px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-muted">
      <span>#</span>
      <span>Player</span>
      <span className="text-center">Trend</span>
      <span className="text-right">Value</span>
      <span className="text-right">P&amp;L</span>
      <span className="text-right">Δ24h</span>
      <span />
    </div>
  );
}

function PinnedYouRow({
  entry,
  points,
  startingBalance,
}: {
  entry: LeaderboardEntry;
  points: LeaderboardHistoryPoint[];
  startingBalance: number;
}) {
  const pnl = pnlPct(entry.totalValue, startingBalance);
  const d24 = delta24hPct(points);
  return (
    <div
      data-current-user="true"
      className="relative grid grid-cols-[28px_minmax(140px,1.4fr)_1fr_100px_70px_70px_18px] items-center gap-3 border-b-2 border-accent/40 bg-accent-bg/60 px-2.5 py-1.5"
      style={{
        backgroundImage:
          'linear-gradient(90deg, var(--accent-bg) 0%, rgba(103,232,249,0.04) 100%)',
      }}
    >
      <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-accent" aria-hidden="true" />
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
        #{String(entry.rank).padStart(2, '0')}
      </span>
      <span className="flex items-center gap-2 truncate text-xs font-semibold text-text-strong">
        <span className="inline-block h-0.5 w-2 rounded-[1px] bg-accent" aria-hidden="true" />
        <span className="truncate">▸ {entry.username}</span>
      </span>
      <PortfolioSparkline
        points={points}
        color="var(--accent)"
        startingBalance={startingBalance}
        strokeWidth={1.75}
        ariaLabel={`Your portfolio trend, ${pnlLabel(pnl)}`}
      />
      <span className="text-right font-mono text-xs text-text-strong">{formatUsd(entry.totalValue)}</span>
      <span className={cn('text-right font-mono text-xs', toneClass(pnl))}>{formatPnl(pnl)}</span>
      <span className={cn('text-right font-mono text-xs', toneClass(d24))}>
        {d24 == null ? '—' : formatPnl(d24)}
      </span>
      <span className="text-right text-muted">›</span>
    </div>
  );
}

const LeaderboardRow = memo(function LeaderboardRow({
  entry,
  points,
  startingBalance,
  isMe,
}: {
  entry: LeaderboardEntry;
  points: LeaderboardHistoryPoint[];
  startingBalance: number;
  isMe: boolean;
}) {
  const pnl = pnlPct(entry.totalValue, startingBalance);
  const d24 = delta24hPct(points);
  const color = colorForPlayer(entry.playerId, isMe);

  return (
    <li
      data-current-user={isMe ? 'true' : undefined}
      className={cn(
        'grid grid-cols-[28px_minmax(140px,1.4fr)_1fr_100px_70px_70px_18px] items-center gap-3 px-2.5 py-1.5 text-xs',
        isMe && 'relative bg-accent-bg/50 before:absolute before:left-0 before:top-1 before:bottom-1 before:w-0.5 before:bg-accent',
      )}
    >
      <span className="font-mono text-[10px] text-muted">
        {String(entry.rank).padStart(2, '0')}
      </span>
      <span className={cn('flex items-center gap-2 truncate font-medium', isMe ? 'text-text-strong' : 'text-text')}>
        <span
          className="inline-block h-0.5 w-2 flex-shrink-0 rounded-[1px]"
          style={{ background: color }}
          aria-hidden="true"
        />
        <span className="truncate">{entry.username}</span>
      </span>
      <PortfolioSparkline
        points={points}
        color={color}
        startingBalance={startingBalance}
        strokeWidth={isMe ? 1.75 : 1.25}
        ariaLabel={`${entry.username} ${pnlLabel(pnl)}`}
      />
      <span className="text-right font-mono text-text">{formatUsd(entry.totalValue)}</span>
      <span className={cn('text-right font-mono', toneClass(pnl))}>{formatPnl(pnl)}</span>
      <span className={cn('text-right font-mono text-[11px]', d24 == null ? 'text-muted' : toneClass(d24))}>
        {d24 == null ? '—' : formatPnl(d24)}
      </span>
      <span className="text-right text-muted">›</span>
    </li>
  );
});

function ExpandFooter({
  expanded,
  hiddenCount,
  youAreHidden,
  myRank,
  onToggle,
}: {
  expanded: boolean;
  hiddenCount: number;
  youAreHidden: boolean;
  myRank: number | null;
  onToggle: () => void;
}) {
  // When collapsed: name where the user is in the hidden tail.
  // When expanded: explicit "show top 10" affordance.
  const label = expanded
    ? `Collapse to top ${VISIBLE_ROWS}`
    : `Show all ${hiddenCount + VISIBLE_ROWS} players`;

  let hint: string | null = null;
  if (!expanded) {
    if (youAreHidden && myRank != null) {
      hint = `${hiddenCount} hidden · including you @ #${myRank}`;
    } else {
      hint = `${hiddenCount} hidden`;
    }
  } else {
    hint = `Showing ${hiddenCount + VISIBLE_ROWS} of ${hiddenCount + VISIBLE_ROWS}`;
  }

  return (
    <div className="flex justify-center border-t border-hairline px-2.5 py-2.5">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex items-center gap-2.5 rounded-chip border border-hairline-strong bg-transparent px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text transition-colors hover:border-accent hover:bg-accent-bg hover:text-text-strong"
      >
        <span className="text-accent text-[9px]">{expanded ? '▴' : '▾'}</span>
        <span>{label}</span>
        {hint ? (
          <span className="border-l border-hairline-strong pl-2.5 text-[10px] tracking-[0.04em] text-muted normal-case">
            {hint}
          </span>
        ) : null}
      </button>
    </div>
  );
}

function pnlPct(totalValue: number, startingBalance: number): number {
  if (startingBalance <= 0) return 0;
  return ((totalValue - startingBalance) / startingBalance) * 100;
}

/**
 * Returns the %-change between the latest point and the most recent point at
 * least 24h older, or `null` when the history is too short to compute. Both
 * sparklines and the standings table read from this so the metric stays
 * consistent.
 */
export function delta24hPct(points: readonly LeaderboardHistoryPoint[]): number | null {
  if (points.length < 2) return null;
  const last = points[points.length - 1];
  if (!last) return null;
  const cutoff = new Date(last.t).getTime() - 24 * 60 * 60 * 1000;
  let earlier: LeaderboardHistoryPoint | null = null;
  for (let i = points.length - 2; i >= 0; i--) {
    const p = points[i];
    if (!p) continue;
    if (new Date(p.t).getTime() <= cutoff) {
      earlier = p;
      break;
    }
  }
  // Fall back to the oldest point when nothing is 24h+ old (e.g. range='1d').
  if (!earlier) earlier = points[0] ?? null;
  if (!earlier || earlier.v === 0) return null;
  return ((last.v - earlier.v) / earlier.v) * 100;
}

function toneClass(pct: number | null): string {
  if (pct == null) return 'text-muted';
  if (pct > 0) return 'text-gain';
  if (pct < 0) return 'text-loss';
  return 'text-muted';
}

function formatUsd(n: number): string {
  return `$${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n)}`;
}

function formatPnl(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${Math.abs(n).toFixed(2)}%`;
}

function pnlLabel(pct: number): string {
  const sign = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
  return `${sign} ${Math.abs(pct).toFixed(2)} percent`;
}
