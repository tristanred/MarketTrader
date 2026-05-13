import { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, type IChartApi, type ISeriesApi } from 'lightweight-charts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLiveStore, type PriceTick } from '@/stores/liveStore';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useStockHistory } from '@/api/stocks';
import type { StockHistoryRange } from '@markettrader/shared';

const RANGES: { key: StockHistoryRange; label: string }[] = [
  { key: '1d', label: '1D' },
  { key: '5d', label: '5D' },
  { key: '1mo', label: '1M' },
  { key: '3mo', label: '3M' },
  { key: '6mo', label: '6M' },
  { key: '1y', label: '1Y' },
];


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

function ChartCanvas({ symbol, range }: { symbol: string; range: StockHistoryRange }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const history = useStockHistory(symbol, range);
  const liveHistory = useLiveStore((s) => s.historyBySymbol[symbol]);
  const latestQuote = useLiveStore((s) => s.pricesBySymbol[symbol]);
  const ticks: PriceTick[] = useMemo(() => liveHistory ?? [], [liveHistory]);
  const marketOpen = latestQuote?.marketState === 'REGULAR';

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

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const historicalBars = history.data?.bars ?? [];
    const lastBar = historicalBars[historicalBars.length - 1];
    const lastHistTime = lastBar ? lastBar.time : 0;

    // After the market closes the upstream just echoes the last regular close
    // every poll; appending those ticks produces a meaningless horizontal line
    // that keeps growing. Outside REGULAR hours the chart freezes at the last
    // historical bar — the latest price still updates elsewhere via the quote.
    const liveTicks = marketOpen
      ? ticks.filter((t) => t.time > lastHistTime).map((t) => ({ time: t.time, value: t.price }))
      : [];

    const merged = [...historicalBars.map((b) => ({ time: b.time, value: b.close })), ...liveTicks];

    const seen = new Set<number>();
    const deduped = merged
      .filter((p) => {
        if (seen.has(p.time)) return false;
        seen.add(p.time);
        return true;
      })
      .sort((a, b) => a.time - b.time)
      .map((p) => ({ time: p.time as never, value: p.value }));

    series.setData(deduped);
  }, [history.data, ticks, marketOpen]);

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
