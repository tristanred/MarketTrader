import type { StockHistoryBar } from '@markettrader/shared';

/** Trading days in each lookback, for daily bars. */
const LOOKBACKS = { m1: 21, m3: 63, m6: 126, y1: 252 } as const;
const MIN_BARS = 20;
const RECENT_CLOSES = 20;

/**
 * Daily price history reduced to the figures an analyst reads off a chart.
 * Percentages are percent (12.5 = 12.5%), prices USD. Fields need enough bars
 * to compute and are absent otherwise.
 */
export interface PriceFeatures {
  bars: number;
  firstDate: string;
  lastDate: string;
  lastClose: number;
  returnsPct: { m1?: number; m3?: number; m6?: number; y1?: number };
  sma: { d20?: number; d50?: number; d200?: number };
  priceVsSmaPct: { d20?: number; d50?: number; d200?: number };
  rangeHigh: number;
  rangeLow: number;
  pctBelowRangeHigh: number;
  pctAboveRangeLow: number;
  rsi14?: number;
  annualizedVolatilityPct?: number;
  /** Mean volume of the last 20 bars over the mean of the last 90. */
  volumeRatio20to90?: number;
  /** Oldest first. */
  recentCloses: number[];
}

/**
 * Summarises daily bars for the analysis prompt, so the model reads ~600 tokens
 * of derived figures instead of a year of raw bars — and does none of the
 * arithmetic it is bad at. Undefined below {@link MIN_BARS} bars.
 */
export function computeFeatures(bars: StockHistoryBar[]): PriceFeatures | undefined {
  const sorted = bars
    .filter((b) => Number.isFinite(b.close) && b.close > 0)
    .sort((a, b) => a.time - b.time);
  if (sorted.length < MIN_BARS) return undefined;

  const closes = sorted.map((b) => b.close);
  const last = closes[closes.length - 1]!;
  const highs = sorted.map((b) => b.high ?? b.close);
  const lows = sorted.map((b) => b.low ?? b.close);
  const rangeHigh = Math.max(...highs);
  const rangeLow = Math.min(...lows);

  const returnsPct: PriceFeatures['returnsPct'] = {};
  for (const [name, days] of Object.entries(LOOKBACKS) as Array<[keyof typeof LOOKBACKS, number]>) {
    // A "1y" range holds ~250 daily bars, not always 253, so allow a little slack.
    if (closes.length <= days * 0.95) continue;
    returnsPct[name] = pct(last, closes[Math.max(0, closes.length - 1 - days)]!);
  }

  const sma: PriceFeatures['sma'] = {};
  const priceVsSmaPct: PriceFeatures['priceVsSmaPct'] = {};
  for (const [name, days] of [['d20', 20], ['d50', 50], ['d200', 200]] as const) {
    if (closes.length < days) continue;
    const avg = mean(closes.slice(-days));
    sma[name] = round(avg);
    priceVsSmaPct[name] = pct(last, avg);
  }

  const volumes = sorted.map((b) => b.volume).filter((v): v is number => v !== undefined && v > 0);
  const volumeRatio20to90 =
    volumes.length >= 90 ? round(mean(volumes.slice(-20)) / mean(volumes.slice(-90))) : undefined;

  return {
    bars: sorted.length,
    firstDate: isoDate(sorted[0]!.time),
    lastDate: isoDate(sorted[sorted.length - 1]!.time),
    lastClose: round(last),
    returnsPct,
    sma,
    priceVsSmaPct,
    rangeHigh: round(rangeHigh),
    rangeLow: round(rangeLow),
    pctBelowRangeHigh: round(((rangeHigh - last) / rangeHigh) * 100),
    pctAboveRangeLow: round(((last - rangeLow) / rangeLow) * 100),
    ...optional('rsi14', rsi(closes, 14)),
    ...optional('annualizedVolatilityPct', annualizedVolatility(closes)),
    ...optional('volumeRatio20to90', volumeRatio20to90),
    recentCloses: closes.slice(-RECENT_CLOSES).map(round),
  };
}

/** Wilder's RSI over the last `period` changes, seeded with a simple average. */
export function rsi(closes: number[], period: number): number | undefined {
  if (closes.length <= period) return undefined;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (loss === 0) return 100;
  return round(100 - 100 / (1 + gain / loss));
}

function annualizedVolatility(closes: number[]): number | undefined {
  const window = closes.slice(-61);
  if (window.length < 21) return undefined;
  const logReturns = window.slice(1).map((c, i) => Math.log(c / window[i]!));
  const m = mean(logReturns);
  const variance = mean(logReturns.map((r) => (r - m) ** 2));
  return round(Math.sqrt(variance) * Math.sqrt(252) * 100);
}

function optional<K extends string>(key: K, value: number | undefined): { [P in K]?: number } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: number };
}

function pct(now: number, then: number): number {
  return round(((now - then) / then) * 100);
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function isoDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}
