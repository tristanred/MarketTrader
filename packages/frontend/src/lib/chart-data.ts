import type {
  CandlestickData,
  HistogramData,
  LineData,
  SeriesMarker,
  UTCTimestamp,
} from 'lightweight-charts';
import type { StockHistoryBar, Trade } from '@markettrader/shared';

export const CHART_UP_COLOR = '#22c55e';
export const CHART_DOWN_COLOR = '#ef4444';
const VOLUME_UP_COLOR = '#22c55e55';
const VOLUME_DOWN_COLOR = '#ef444455';

const ts = (t: number) => t as UTCTimestamp;

/** Maps history bars to close-price points for a line or area series. */
export function toLinePoints(bars: StockHistoryBar[]): LineData[] {
  return bars.map((b) => ({ time: ts(b.time), value: b.close }));
}

/** Maps history bars to candles; a missing open/high/low falls back to `close` (a flat candle). */
export function toCandles(bars: StockHistoryBar[]): CandlestickData[] {
  return bars.map((b) => ({
    time: ts(b.time),
    open: b.open ?? b.close,
    high: b.high ?? b.close,
    low: b.low ?? b.close,
    close: b.close,
  }));
}

/** Volume histogram points, tinted by bar direction. Empty when no bar carries volume. */
export function toVolumeBars(bars: StockHistoryBar[]): HistogramData[] {
  if (!bars.some((b) => b.volume != null)) return [];
  return bars.map((b) => ({
    time: ts(b.time),
    value: b.volume ?? 0,
    color: b.close >= (b.open ?? b.close) ? VOLUME_UP_COLOR : VOLUME_DOWN_COLOR,
  }));
}

/**
 * Folds a live tick into the tail candle: extends it when the tick lands inside
 * its bucket, otherwise opens a new candle on the tail's bar grid. The result's
 * time is never earlier than `last.time`, because `series.update()` throws on that.
 */
export function foldTick(
  last: CandlestickData | null,
  tick: { time: number; price: number },
  barSeconds: number,
): CandlestickData {
  const lastTime = last ? (last.time as number) : -Infinity;
  if (last && tick.time < lastTime + barSeconds) {
    return {
      time: last.time,
      open: last.open,
      high: Math.max(last.high, tick.price),
      low: Math.min(last.low, tick.price),
      close: tick.price,
    };
  }
  // Anchor to the tail rather than the epoch grid: Yahoo's hourly bars start
  // at :30, so an epoch-aligned bucket would overlap the tail candle.
  const bucket = last
    ? lastTime + Math.floor((tick.time - lastTime) / barSeconds) * barSeconds
    : Math.floor(tick.time / barSeconds) * barSeconds;
  const p = tick.price;
  return { time: ts(bucket), open: p, high: p, low: p, close: p };
}

/**
 * Buy/sell markers for `symbol`'s fills, each snapped onto the last rendered
 * point at or before its execution time. A fill newer than the last point
 * snaps to that point; one older than the first point is dropped.
 */
export function tradesToMarkers(
  trades: Trade[],
  symbol: string,
  pointTimes: number[],
): SeriesMarker<UTCTimestamp>[] {
  if (pointTimes.length === 0) return [];
  const markers: SeriesMarker<UTCTimestamp>[] = [];
  for (const t of trades) {
    if (t.symbol !== symbol) continue;
    const sec = Math.floor(new Date(t.executedAt).getTime() / 1000);
    const idx = lastIndexAtOrBefore(pointTimes, sec);
    if (idx < 0) continue;
    const buy = t.direction === 'buy';
    markers.push({
      time: ts(pointTimes[idx]!),
      position: buy ? 'belowBar' : 'aboveBar',
      color: buy ? CHART_UP_COLOR : CHART_DOWN_COLOR,
      shape: buy ? 'arrowUp' : 'arrowDown',
      text: `${buy ? 'B' : 'S'} ${t.quantity}`,
    });
  }
  return markers.sort((a, b) => a.time - b.time);
}

function lastIndexAtOrBefore(sorted: number[], t: number): number {
  let lo = 0;
  let hi = sorted.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
