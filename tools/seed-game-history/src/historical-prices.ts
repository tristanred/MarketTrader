import type {
  StockHistoryBar,
  StockHistoryRange,
} from '@markettrader/shared';
import { createProvider } from '../../../packages/server/src/providers/factory.js';

/** Map of symbol → ascending-by-time bars. */
type PriceMap = Map<string, StockHistoryBar[]>;

/**
 * Chooses the smallest {@link StockHistoryRange} that covers `[startISO, now]`.
 * The provider caps at `1y`; older games will simply have fewer eligible
 * trades (those before the earliest bar are skipped by {@link priceAt}).
 */
export function pickRange(startISO: string): StockHistoryRange {
  const days = (Date.now() - new Date(startISO).getTime()) / 86_400_000;
  if (days <= 1) return '1d';
  if (days <= 5) return '5d';
  if (days <= 31) return '1mo';
  if (days <= 93) return '3mo';
  if (days <= 186) return '6mo';
  return '1y';
}

/**
 * Pre-fetches daily bars for every symbol in `symbols`, using the configured
 * {@link StockProvider}. Returns an object with a `priceAt` lookup that maps
 * `(symbol, timestamp)` to the latest bar close at-or-before `timestamp`.
 * Returns `null` from `priceAt` when no bar covers the requested time.
 */
export async function loadHistoricalPrices(
  symbols: readonly string[],
  gameStartISO: string,
): Promise<{
  priceAt: (symbol: string, timestampISO: string) => number | null;
  earliestBarMs: number;
}> {
  const provider = createProvider();
  const range = pickRange(gameStartISO);
  const map: PriceMap = new Map();
  let earliestBarMs = Infinity;

  for (const symbol of symbols) {
    try {
      const bars = await provider.getHistory(symbol, range);
      const sorted = [...bars].sort((a, b) => a.time - b.time);
      map.set(symbol, sorted);
      const first = sorted[0];
      if (first && first.time * 1000 < earliestBarMs) {
        earliestBarMs = first.time * 1000;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[warn] history fetch failed for ${symbol}: ${msg}`);
    }
  }

  return {
    earliestBarMs,
    priceAt: (symbol, timestampISO) => {
      const bars = map.get(symbol);
      if (!bars || bars.length === 0) return null;
      const ts = new Date(timestampISO).getTime() / 1000;
      // Binary search for the latest bar with time <= ts.
      let lo = 0;
      let hi = bars.length - 1;
      let best: StockHistoryBar | null = null;
      while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        const bar = bars[mid]!;
        if (bar.time <= ts) {
          best = bar;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return best ? best.close : null;
    },
  };
}
