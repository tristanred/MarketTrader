import type { StockHistoryBar } from '@markettrader/shared';

/** One daily bar per close, starting 2025-10-01 UTC. */
export function dailySeries(closes: number[], volume = 1_000_000): StockHistoryBar[] {
  const start = Date.parse('2025-10-01T00:00:00Z') / 1000;
  return closes.map((close, i) => ({ time: start + i * 86_400, close, volume }));
}
