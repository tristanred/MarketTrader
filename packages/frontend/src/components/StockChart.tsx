import { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, type IChartApi, type ISeriesApi } from 'lightweight-charts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLiveStore, type PriceTick } from '@/stores/liveStore';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Renders a live line chart for one held symbol, fed by ticks accumulated in
 * the live store from WebSocket `price_update` events. Historical data is not
 * currently exposed by the backend; this chart populates as new ticks arrive.
 */
export function StockChart({ symbols }: { symbols: string[] }) {
  const [selected, setSelected] = useState<string | null>(symbols[0] ?? null);

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
      </CardHeader>
      <CardContent>{selected && <ChartCanvas symbol={selected} />}</CardContent>
    </Card>
  );
}

function ChartCanvas({ symbol }: { symbol: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const history = useLiveStore((s) => s.historyBySymbol[symbol]);
  const ticks: PriceTick[] = useMemo(() => history ?? [], [history]);

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
    if (ticks.length === 0) {
      series.setData([]);
      return;
    }
    // dedupe by time (lightweight-charts requires strictly ascending time)
    const seen = new Set<number>();
    const data = ticks
      .filter((t) => {
        if (seen.has(t.time)) return false;
        seen.add(t.time);
        return true;
      })
      .map((t) => ({ time: t.time as never, value: t.price }));
    series.setData(data);
  }, [ticks]);

  return (
    <div className="space-y-2">
      <div ref={containerRef} className="w-full" />
      {ticks.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Waiting for live ticks… {symbol} updates arrive every 5 seconds via WebSocket.
        </p>
      )}
    </div>
  );
}
