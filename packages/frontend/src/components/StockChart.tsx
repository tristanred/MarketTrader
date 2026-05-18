import { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, type IChartApi, type ISeriesApi } from 'lightweight-charts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLiveStore, type PriceTick } from '@/stores/liveStore';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useStockHistory } from '@/api/stocks';
import { useMarketStatus } from '@/api/market-status';
import type { StockHistoryRange } from '@markettrader/shared';

export const RANGES: { key: StockHistoryRange; label: string }[] = [
  { key: '1d', label: '1D' },
  { key: '5d', label: '5D' },
  { key: '1mo', label: '1M' },
  { key: '3mo', label: '3M' },
  { key: '6mo', label: '6M' },
  { key: '1y', label: '1Y' },
];

// Reused empty array so consumers don't allocate per-render. `useLiveStore(...)`
// returns `undefined` when no ticks exist for the selected symbol; falling
// back to a stable reference keeps render output Object.is-equal.
const EMPTY_TICKS: PriceTick[] = [];


/**
 * Renders a price line chart for one held symbol. Historical bars are fetched
 * from `/stocks/:symbol/history`; live WebSocket ticks accumulated in the
 * live store are then appended on top so the right edge stays current.
 */
export function StockChart({ symbols }: { symbols: string[] }) {
  const [selected, setSelected] = useState<string | null>(symbols[0] ?? null);
  const [range, setRange] = useState<StockHistoryRange>('1d');

  useEffect(() => {
    if (selected && !symbols.includes(selected)) setSelected(symbols[0] ?? null);
    else if (!selected && symbols[0]) setSelected(symbols[0]);
  }, [symbols, selected]);

  if (symbols.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Price chart</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Buy a stock to see its live price chart here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle>Price chart</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-2">
            {symbols.map((s) => (
              <Button
                key={s}
                size="sm"
                variant={s === selected ? 'default' : 'outline'}
                onClick={() => setSelected(s)}
                className={cn('h-7 px-2 text-xs')}
              >
                {s}
              </Button>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap gap-1">
            {RANGES.map((r) => (
              <Button
                key={r.key}
                size="sm"
                variant={r.key === range ? 'default' : 'ghost'}
                onClick={() => setRange(r.key)}
                className="h-7 px-2 text-xs"
              >
                {r.label}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>{selected && <ChartCanvas symbol={selected} range={range} />}</CardContent>
    </Card>
  );
}

export function ChartCanvas({ symbol, range }: { symbol: string; range: StockHistoryRange }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const history = useStockHistory(symbol, range);
  const liveHistory = useLiveStore((s) => s.historyBySymbol[symbol]);
  const ticks: PriceTick[] = liveHistory ?? EMPTY_TICKS;
  const marketStatus = useMarketStatus();
  const marketOpen = marketStatus.data?.state === 'REGULAR';

  // Map historical bars once per `history.data` change, not on every tick.
  // Ticks change every ~5s while market open; the historical portion doesn't.
  const historicalSeries = useMemo(() => {
    const bars = history.data?.bars ?? [];
    return bars.map((b) => ({ time: b.time, value: b.close }));
  }, [history.data]);
  const lastHistTime =
    historicalSeries.length > 0 ? historicalSeries[historicalSeries.length - 1]!.time : 0;
  // Track the last tick time we appended via `series.update()` so we know
  // when to extend vs. when to redraw the whole series.
  const lastAppendedTimeRef = useRef<number>(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 300,
      layout: { background: { color: 'transparent' }, textColor: '#888' },
      grid: { vertLines: { color: '#2a2a2a33' }, horzLines: { color: '#2a2a2a33' } },
      timeScale: { timeVisible: true, secondsVisible: true },
    });
    const series = chart.addLineSeries({ color: '#22c55e', lineWidth: 2 });
    chartRef.current = chart;
    seriesRef.current = series;

    const resize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', resize);

    return () => {
      window.removeEventListener('resize', resize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Full redraw whenever the historical bars change (symbol/range change or
  // initial load). After this runs, lastAppendedTimeRef is reset and the
  // per-tick effect takes over.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    // Outside REGULAR hours we freeze at the last historical bar — see the
    // per-tick effect for the rationale.
    series.setData(
      historicalSeries.map((p) => ({ time: p.time as never, value: p.value })),
    );
    lastAppendedTimeRef.current = lastHistTime;
  }, [historicalSeries, lastHistTime]);

  // Incremental append on each new tick. lightweight-charts' `update()` only
  // touches the tail of the series, avoiding a full reflow.
  // After the market closes the upstream just echoes the last regular close
  // every poll; appending those ticks produces a meaningless horizontal line
  // that keeps growing. Outside REGULAR hours we ignore live ticks entirely.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !marketOpen) return;
    for (const t of ticks) {
      if (t.time <= lastAppendedTimeRef.current) continue;
      series.update({ time: t.time as never, value: t.price });
      lastAppendedTimeRef.current = t.time;
    }
  }, [ticks, marketOpen]);

  // Fit the time axis once per (symbol, range) load — not on every tick, which
  // would reflow the whole chart and look jumpy.
  useEffect(() => {
    if (!history.data || history.data.bars.length === 0) return;
    chartRef.current?.timeScale().fitContent();
  }, [history.data]);

  const empty = (history.data?.bars.length ?? 0) === 0 && ticks.length === 0;
  return (
    <div className="space-y-2">
      <div ref={containerRef} className="w-full" />
      {history.isLoading && (
        <p className="text-xs text-muted-foreground">Loading {symbol} history…</p>
      )}
      {history.isError && (
        <p className="text-xs text-destructive">
          Could not load {symbol} history. Live ticks will still appear.
        </p>
      )}
      {empty && !history.isLoading && !history.isError && (
        <p className="text-xs text-muted-foreground">
          No data for {symbol}. Live ticks arrive every 5 seconds via WebSocket.
        </p>
      )}
    </div>
  );
}
