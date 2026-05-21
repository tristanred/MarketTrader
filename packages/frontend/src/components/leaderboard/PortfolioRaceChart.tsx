import { useMemo, useState } from 'react';
import type {
  LeaderboardHistoryRange,
  LeaderboardHistoryResponse,
  LeaderboardHistorySeries,
} from '@markettrader/shared';
import { Panel, PanelHeader } from '@/components/panel';
import { colorForPlayer } from '@/components/charts/portfolio-colors';
import { cn } from '@/lib/utils';

export type ChartViewMode = 'value' | 'pnl' | 'rank';
export type SeriesViewMode = 'top10' | 'all' | 'custom';

export interface PortfolioRaceChartProps {
  history: LeaderboardHistoryResponse;
  startingBalance: number;
  currentUserId: string | null;
  range: LeaderboardHistoryRange;
  onRangeChange: (r: LeaderboardHistoryRange) => void;
  className?: string;
}

const RANGE_OPTIONS: { key: LeaderboardHistoryRange; label: string }[] = [
  { key: '1d', label: '1D' },
  { key: '5d', label: '5D' },
  { key: '10d', label: '10D' },
  { key: 'all', label: 'ALL' },
];

const VIEW_OPTIONS: { key: ChartViewMode; label: string }[] = [
  { key: 'value', label: 'Value' },
  { key: 'pnl', label: '% P&L' },
  { key: 'rank', label: 'Rank' },
];

const SERIES_OPTIONS: { key: SeriesViewMode; label: string }[] = [
  { key: 'top10', label: 'Top 10 + you' },
  { key: 'all', label: 'All players' },
  { key: 'custom', label: 'Custom' },
];

const CHART_WIDTH = 1100;
const CHART_HEIGHT = 380;
const PADDING_TOP = 40;
const PADDING_BOTTOM = 60;
const PADDING_LEFT = 60;
const PADDING_RIGHT = 120;
const PLOT_W = CHART_WIDTH - PADDING_LEFT - PADDING_RIGHT;
const PLOT_H = CHART_HEIGHT - PADDING_TOP - PADDING_BOTTOM;

/**
 * Full-page race chart for the dedicated leaderboard page. Hand-rolled SVG —
 * lightweight-charts is single-series-oriented and would fight us on 11+
 * overlaid lines, end-of-line labels, and the field-band envelope.
 *
 * Three view modes:
 *   • Value — Y = portfolio value
 *   • % P&L — Y = pct change from starting balance (normalises all players)
 *   • Rank — Y = rank (1 at top); overtakes become explicit X-crossings
 *
 * Three series modes:
 *   • Top-10 + you — full colour for top 10 + current user; the rest collapse
 *     into a faded grey field-band envelope (5th–95th percentile)
 *   • All players — every series in colour
 *   • Custom — user toggles individual series via the legend
 */
export function PortfolioRaceChart({
  history,
  startingBalance,
  currentUserId,
  range,
  onRangeChange,
  className,
}: PortfolioRaceChartProps) {
  const [viewMode, setViewMode] = useState<ChartViewMode>('value');
  const [seriesMode, setSeriesMode] = useState<SeriesViewMode>('top10');
  const [muted, setMuted] = useState<Set<string>>(new Set());

  // Identify the "important" series — top 10 by latest rank + the current user.
  const importantPlayerIds = useMemo(() => {
    const ids = new Set<string>();
    if (currentUserId) ids.add(currentUserId);
    const withRank = history.series
      .map((s) => ({ id: s.playerId, lastRank: s.points[s.points.length - 1]?.r ?? Infinity }))
      .sort((a, b) => a.lastRank - b.lastRank);
    for (const r of withRank.slice(0, 10)) ids.add(r.id);
    return ids;
  }, [history.series, currentUserId]);

  // Active vs. background series, derived from seriesMode + per-user mute set.
  const { activeSeries, fieldSeries } = useMemo(() => {
    const active: LeaderboardHistorySeries[] = [];
    const field: LeaderboardHistorySeries[] = [];
    for (const s of history.series) {
      if (muted.has(s.playerId)) {
        field.push(s);
        continue;
      }
      if (seriesMode === 'all') {
        active.push(s);
      } else if (seriesMode === 'top10') {
        if (importantPlayerIds.has(s.playerId)) active.push(s);
        else field.push(s);
      } else {
        // custom: nothing is auto-muted; everything is active until the user mutes.
        active.push(s);
      }
    }
    return { activeSeries: active, fieldSeries: field };
  }, [history.series, seriesMode, importantPlayerIds, muted]);

  // Project a series' points into chart coordinates given the active view.
  const { startMs, endMs, yMin, yMax } = useMemo(() => {
    const startMs = new Date(history.startedAt).getTime();
    const endMs = new Date(history.endedAt).getTime();
    let yMin = Infinity;
    let yMax = -Infinity;
    const considered = activeSeries.length > 0 ? activeSeries : history.series;
    for (const s of considered) {
      for (const p of s.points) {
        const y = projectY(p.v, p.r, viewMode, startingBalance);
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }
    }
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
      yMin = 0;
      yMax = 1;
    }
    if (yMin === yMax) {
      yMin -= 1;
      yMax += 1;
    }
    return { startMs, endMs, yMin, yMax };
  }, [activeSeries, history.series, history.startedAt, history.endedAt, viewMode, startingBalance]);

  const toX = (tIso: string): number => {
    const t = new Date(tIso).getTime();
    if (endMs === startMs) return PADDING_LEFT;
    return PADDING_LEFT + ((t - startMs) / (endMs - startMs)) * PLOT_W;
  };
  const toY = (v: number, r: number): number => {
    const raw = projectY(v, r, viewMode, startingBalance);
    return PADDING_TOP + (1 - (raw - yMin) / (yMax - yMin)) * PLOT_H;
  };

  // Field-band envelope: for each x-tick, take 5th and 95th percentile of
  // the active view's value at that time across the field series. Computed
  // by sampling each field series at its actual capture points.
  const fieldPath = useMemo(() => {
    if (fieldSeries.length < 3) return null;
    return buildFieldEnvelope(fieldSeries, toX, toY);
  }, [fieldSeries, toX, toY]);

  // Toggle a series' mute state; only the "custom" mode acts on it.
  const onLegendClick = (playerId: string) => {
    setSeriesMode('custom');
    setMuted((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
  };

  return (
    <Panel className={className}>
      <PanelHeader
        right={
          <span className="flex items-center gap-2">
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted">VIEW</span>
            <ChipGroup
              options={SERIES_OPTIONS}
              value={seriesMode}
              onChange={(v) => {
                setSeriesMode(v);
                if (v !== 'custom') setMuted(new Set());
              }}
            />
          </span>
        }
      >
        Portfolio race
        <span className="ml-2 font-mono text-[10px] normal-case tracking-normal text-muted">
          · {history.series.length} series
        </span>
      </PanelHeader>

      <div className="flex flex-wrap items-center gap-2 px-2.5 pt-2">
        <ChipGroup options={RANGE_OPTIONS} value={range} onChange={onRangeChange} />
        <div className="flex-1" />
        <ChipGroup options={VIEW_OPTIONS} value={viewMode} onChange={setViewMode} />
      </div>

      <div className="px-2.5 py-2">
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          width="100%"
          className="block h-auto"
          role="img"
          aria-label="Player portfolio values over the requested time range"
        >
          {/* Grid */}
          <Grid />
          {/* Baseline at starting balance, only when viewing value/pnl */}
          {viewMode !== 'rank' ? (
            <Baseline
              y={
                viewMode === 'value'
                  ? PADDING_TOP + (1 - (startingBalance - yMin) / (yMax - yMin)) * PLOT_H
                  : PADDING_TOP + (1 - (0 - yMin) / (yMax - yMin)) * PLOT_H
              }
              label={viewMode === 'value' ? `$${startingBalance.toLocaleString('en-US')} START` : '0% START'}
            />
          ) : null}

          {/* Field band (drawn behind active series) */}
          {fieldPath ? <path d={fieldPath} fill="rgba(107,114,128,0.06)" stroke="none" /> : null}
          {seriesMode === 'top10' && fieldSeries.length > 0 ? (
            <text
              x={PADDING_LEFT + PLOT_W / 2}
              y={PADDING_TOP + PLOT_H - 8}
              textAnchor="middle"
              className="fill-muted font-mono text-[9px]"
              style={{ letterSpacing: '0.16em' }}
            >
              · · · {fieldSeries.length} players in the field band · · ·
            </text>
          ) : null}

          {/* Active series — current user last so it draws on top */}
          {activeSeries
            .filter((s) => s.playerId !== currentUserId)
            .map((s) => (
              <SeriesPath key={s.playerId} series={s} toX={toX} toY={toY} isCurrentUser={false} />
            ))}
          {activeSeries
            .filter((s) => s.playerId === currentUserId)
            .map((s) => (
              <SeriesPath key={s.playerId} series={s} toX={toX} toY={toY} isCurrentUser />
            ))}

          {/* Axes */}
          <Axes
            startMs={startMs}
            endMs={endMs}
            yMin={yMin}
            yMax={yMax}
            viewMode={viewMode}
          />
        </svg>
      </div>

      {/* Legend / toggle bar */}
      <div className="flex flex-wrap gap-1.5 border-t border-hairline px-2.5 py-2.5">
        {history.series
          .slice()
          .sort((a, b) => {
            const ar = a.points[a.points.length - 1]?.r ?? Infinity;
            const br = b.points[b.points.length - 1]?.r ?? Infinity;
            return ar - br;
          })
          .map((s) => {
            const isMe = s.playerId === currentUserId;
            const isMuted = muted.has(s.playerId);
            const isInField = seriesMode === 'top10' && !importantPlayerIds.has(s.playerId);
            const color = colorForPlayer(s.playerId, isMe);
            const last = s.points[s.points.length - 1];
            const pnl = last
              ? ((last.v - startingBalance) / startingBalance) * 100
              : null;
            return (
              <button
                key={s.playerId}
                type="button"
                onClick={() => onLegendClick(s.playerId)}
                className={cn(
                  'flex max-w-[180px] items-center gap-2 truncate rounded-chip border px-2 py-0.5 text-[11px] transition-colors',
                  isMe ? 'border-accent text-text-strong' : 'border-hairline-strong text-text',
                  (isMuted || isInField) && 'opacity-40',
                  'hover:border-text',
                )}
                aria-pressed={!isMuted && !isInField}
              >
                <span
                  className="inline-block h-0.5 w-2.5 flex-shrink-0 rounded-[1px]"
                  style={{ background: color }}
                  aria-hidden="true"
                />
                <span className="truncate">{isMe ? `${s.username} (you)` : s.username}</span>
                {pnl != null ? (
                  <span className={cn('font-mono text-[10px]', pnl > 0 ? 'text-gain' : pnl < 0 ? 'text-loss' : 'text-muted')}>
                    {pnl > 0 ? '+' : pnl < 0 ? '−' : ''}
                    {Math.abs(pnl).toFixed(2)}%
                  </span>
                ) : null}
              </button>
            );
          })}
      </div>
    </Panel>
  );
}

function projectY(
  v: number,
  r: number,
  mode: ChartViewMode,
  startingBalance: number,
): number {
  if (mode === 'value') return v;
  if (mode === 'pnl') {
    if (startingBalance <= 0) return 0;
    return ((v - startingBalance) / startingBalance) * 100;
  }
  // rank: invert so rank 1 is at the top (highest projected value)
  return -r;
}

function SeriesPath({
  series,
  toX,
  toY,
  isCurrentUser,
}: {
  series: LeaderboardHistorySeries;
  toX: (t: string) => number;
  toY: (v: number, r: number) => number;
  isCurrentUser: boolean;
}) {
  if (series.points.length === 0) return null;
  const color = colorForPlayer(series.playerId, isCurrentUser);
  let d = '';
  for (let i = 0; i < series.points.length; i++) {
    const p = series.points[i]!;
    const x = toX(p.t);
    const y = toY(p.v, p.r);
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)} `;
  }
  const last = series.points[series.points.length - 1]!;
  const endX = toX(last.t);
  const endY = toY(last.v, last.r);
  return (
    <>
      <path
        d={d.trim()}
        fill="none"
        stroke={color}
        strokeWidth={isCurrentUser ? 2.25 : 1.25}
        strokeLinejoin="round"
        opacity={isCurrentUser ? 1 : 0.85}
      />
      <circle cx={endX} cy={endY} r={isCurrentUser ? 4 : 3} fill={color} stroke="var(--panel)" strokeWidth={1.5} />
      <text
        x={endX + 6}
        y={endY + 4}
        fill={color}
        className="font-mono"
        style={{ fontSize: isCurrentUser ? 11 : 10, fontWeight: isCurrentUser ? 600 : 400 }}
      >
        {isCurrentUser ? `▸ ${series.username}` : series.username}
      </text>
    </>
  );
}

function Grid() {
  const lines = [];
  for (let i = 0; i <= 4; i++) {
    const y = PADDING_TOP + (i / 4) * PLOT_H;
    lines.push(
      <line
        key={i}
        x1={PADDING_LEFT}
        x2={PADDING_LEFT + PLOT_W}
        y1={y}
        y2={y}
        stroke="var(--hairline)"
      />,
    );
  }
  return <g>{lines}</g>;
}

function Baseline({ y, label }: { y: number; label: string }) {
  return (
    <g>
      <line
        x1={PADDING_LEFT}
        x2={PADDING_LEFT + PLOT_W}
        y1={y}
        y2={y}
        stroke="var(--hairline-strong)"
        strokeDasharray="2 3"
      />
      <text
        x={PADDING_LEFT + 6}
        y={y - 4}
        className="fill-muted font-mono"
        style={{ fontSize: 10, letterSpacing: '0.08em' }}
      >
        {label}
      </text>
    </g>
  );
}

function Axes({
  startMs,
  endMs,
  yMin,
  yMax,
  viewMode,
}: {
  startMs: number;
  endMs: number;
  yMin: number;
  yMax: number;
  viewMode: ChartViewMode;
}) {
  const xTicks = 5;
  const yTicks = 4;
  const formatY = (v: number) => {
    if (viewMode === 'value') {
      if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(1)}K`;
      return `$${v.toFixed(0)}`;
    }
    if (viewMode === 'pnl') {
      const sign = v > 0 ? '+' : v < 0 ? '−' : '';
      return `${sign}${Math.abs(v).toFixed(1)}%`;
    }
    // rank: y is negative rank; flip back for the label
    return `#${Math.round(-v)}`;
  };
  const formatX = (ms: number) => {
    if (ms === endMs) return 'NOW';
    const d = new Date(ms);
    return d.toISOString().slice(5, 10).replace('-', '/');
  };

  return (
    <g>
      {Array.from({ length: yTicks + 1 }, (_, i) => {
        const v = yMin + (i / yTicks) * (yMax - yMin);
        const y = PADDING_TOP + (1 - i / yTicks) * PLOT_H;
        return (
          <text
            key={i}
            x={PADDING_LEFT - 8}
            y={y + 3}
            textAnchor="end"
            className="fill-muted font-mono"
            style={{ fontSize: 9, letterSpacing: '0.1em' }}
          >
            {formatY(v)}
          </text>
        );
      })}
      {Array.from({ length: xTicks + 1 }, (_, i) => {
        const t = startMs + (i / xTicks) * (endMs - startMs);
        const x = PADDING_LEFT + (i / xTicks) * PLOT_W;
        return (
          <text
            key={i}
            x={x}
            y={PADDING_TOP + PLOT_H + 18}
            textAnchor="middle"
            className="fill-muted font-mono"
            style={{ fontSize: 9, letterSpacing: '0.1em' }}
          >
            {formatX(t)}
          </text>
        );
      })}
    </g>
  );
}

function buildFieldEnvelope(
  fieldSeries: LeaderboardHistorySeries[],
  toX: (t: string) => number,
  toY: (v: number, r: number) => number,
): string | null {
  // Collect every unique timestamp present anywhere in the field, then compute
  // 5th and 95th percentile of projected values at that timestamp (linear
  // interp from the nearest preceding point per series).
  const tSet = new Set<string>();
  for (const s of fieldSeries) {
    for (const p of s.points) tSet.add(p.t);
  }
  const timestamps = [...tSet].sort();
  if (timestamps.length < 2) return null;

  const lowerPath: string[] = [];
  const upperPath: string[] = [];

  for (const t of timestamps) {
    const tMs = new Date(t).getTime();
    const values: { y: number }[] = [];
    for (const s of fieldSeries) {
      // Find the most recent point ≤ t for this series.
      let chosen: { v: number; r: number } | null = null;
      for (const p of s.points) {
        if (new Date(p.t).getTime() <= tMs) chosen = p;
        else break;
      }
      if (!chosen) continue;
      values.push({ y: toY(chosen.v, chosen.r) });
    }
    if (values.length < 3) continue;
    values.sort((a, b) => a.y - b.y);
    const lo = values[Math.floor(values.length * 0.05)]!;
    const hi = values[Math.floor(values.length * 0.95)]!;
    const x = toX(t);
    upperPath.push(`${x.toFixed(2)} ${lo.y.toFixed(2)}`);
    lowerPath.push(`${x.toFixed(2)} ${hi.y.toFixed(2)}`);
  }

  if (upperPath.length < 2) return null;
  const lowerReversed = lowerPath.reverse();
  return `M${upperPath.join(' L')} L${lowerReversed.join(' L')} Z`;
}

function ChipGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <span className="flex gap-1">
      {options.map((o) => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.key)}
            className={cn(
              'rounded-chip px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors',
              active
                ? 'border border-accent bg-accent-bg text-accent'
                : 'border border-hairline-strong text-muted hover:border-text hover:text-text',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </span>
  );
}
