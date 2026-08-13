import { useMemo } from 'react';
import type { LeaderboardHistoryPoint } from '@markettrader/shared';

export interface PortfolioSparklineProps {
  points: readonly LeaderboardHistoryPoint[];
  color: string;
  /** Game's starting balance — anchors the dashed mid-line baseline. */
  startingBalance: number;
  /**
   * viewBox coordinate width the path is projected into. The rendered width
   * is always 100% of the grid track — this only sets the drawing basis.
   */
  width?: number;
  /** Rendered SVG height in CSS pixels. Default 24. */
  height?: number;
  /** Stroke weight. Heavier (1.75) for the pinned "you" row. Default 1.25. */
  strokeWidth?: number;
  /** Accessible label, e.g. `"alice — +12.40%"`. */
  ariaLabel?: string;
}

/**
 * Compact SVG line chart used per-row in the leaderboard panel and on the
 * dedicated page. No dependency on `lightweight-charts` — at 31 instances
 * per panel the per-component overhead has to stay near zero.
 *
 * Normalises its Y axis independently per row (a flat tristan at $100k can't
 * mute a +5% leader), but anchors the dashed mid-line at the game's starting
 * balance so the eye reads "above/below the start" consistently across rows.
 *
 * Renders at `w-full` rather than a fixed pixel width: a hard `width` made the
 * enclosing leaderboard grid un-shrinkable and widened the whole document on
 * narrow viewports. `preserveAspectRatio="none"` lets the x axis squash to fit,
 * and `vector-effect="non-scaling-stroke"` keeps the line an even weight when
 * it does. `overflow-visible` is what keeps the end-dot round — it sits at
 * `cx === width`, so the default SVG clip would slice it into a vertical tick.
 */
export function PortfolioSparkline({
  points,
  color,
  startingBalance,
  width = 240,
  height = 24,
  strokeWidth = 1.25,
  ariaLabel,
}: PortfolioSparklineProps) {
  const path = useMemo(() => {
    if (points.length === 0) return { d: '', endX: width, endY: height / 2, baselineY: height / 2 };

    let min = startingBalance;
    let max = startingBalance;
    for (const p of points) {
      if (p.v < min) min = p.v;
      if (p.v > max) max = p.v;
    }
    // Guard a flat series so we don't divide by zero.
    const range = max - min || 1;
    // Padding keeps the line from touching the very top/bottom of the box.
    const pad = 2;
    const innerH = height - pad * 2;
    const project = (v: number) => pad + innerH * (1 - (v - min) / range);

    const xStep = points.length > 1 ? width / (points.length - 1) : width;
    let d = '';
    for (let i = 0; i < points.length; i++) {
      const x = i * xStep;
      const p = points[i];
      if (!p) continue;
      const y = project(p.v);
      d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)} `;
    }
    const last = points[points.length - 1];
    const endY = last ? project(last.v) : height / 2;
    return {
      d: d.trim(),
      endX: width,
      endY,
      baselineY: project(startingBalance),
    };
  }, [points, startingBalance, width, height]);

  if (points.length === 0) {
    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="block w-full overflow-visible"
        height={height}
        preserveAspectRatio="none"
        aria-label={ariaLabel ?? 'No history yet'}
        role="img"
      >
        <line
          x1={0}
          x2={width}
          y1={height / 2}
          y2={height / 2}
          stroke="var(--hairline-strong)"
          strokeDasharray="1 3"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="block w-full overflow-visible"
      height={height}
      preserveAspectRatio="none"
      aria-label={ariaLabel}
      role="img"
    >
      <line
        x1={0}
        x2={width}
        y1={path.baselineY}
        y2={path.baselineY}
        stroke="var(--hairline-strong)"
        strokeDasharray="1 3"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={path.d}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={path.endX} cy={path.endY} r={1.75} fill={color} />
    </svg>
  );
}
