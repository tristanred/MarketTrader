import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart,
  LineStyle,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLiveStore, type PriceTick } from '@/stores/liveStore';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useStockHistory } from '@/api/stocks';
import { useMarketStatus } from '@/api/market-status';
import { usePortfolio, useTradeHistory } from '@/api/trades';
import { useChartPrefsStore, type ChartType } from '@/stores/chartPrefsStore';
import {
  CHART_DOWN_COLOR,
  CHART_UP_COLOR,
  foldTick,
  toCandles,
  toLinePoints,
  toVolumeBars,
  tradesToMarkers,
} from '@/lib/chart-data';
import type { StockHistoryBar, StockHistoryRange } from '@markettrader/shared';

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
const EMPTY_BARS: StockHistoryBar[] = [];

/**
 * Symbol and range picker around {@link ChartCanvas}. Historical bars are fetched
 * from `/stocks/:symbol/history`; live WebSocket ticks accumulated in the
 * live store are then appended on top so the right edge stays current.
 */
export function StockChart({
  symbols,
  gameId,
}: {
  symbols: string[];
  gameId?: string | undefined;
}) {
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
      <CardContent>{selected && <ChartCanvas symbol={selected} range={range} gameId={gameId} />}</CardContent>
    </Card>
  );
}

type MainSeries =
  | { kind: 'candles'; api: ISeriesApi<'Candlestick'> }
  | { kind: 'line'; api: ISeriesApi<'Line'> | ISeriesApi<'Area'> };

const CHART_TYPES: { key: ChartType; label: string }[] = [
  { key: 'line', label: 'Line' },
  { key: 'area', label: 'Area' },
  { key: 'candles', label: 'Candles' },
];

/**
 * Price chart for one symbol and range: line, area or candlesticks, with an
 * optional volume pane. When `gameId` is given, the viewer's fills are drawn as
 * buy/sell markers and their average cost as a dashed price line.
 * `wheelZoom={false}` leaves the mouse wheel to the surrounding scroll
 * container (drag and pinch still pan and zoom).
 */
export function ChartCanvas({
  symbol,
  range,
  gameId,
  wheelZoom = true,
}: {
  symbol: string;
  range: StockHistoryRange;
  gameId?: string | undefined;
  wheelZoom?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainRef = useRef<MainSeries | null>(null);
  const history = useStockHistory(symbol, range);
  const liveHistory = useLiveStore((s) => s.historyBySymbol[symbol]);
  const ticks: PriceTick[] = liveHistory ?? EMPTY_TICKS;
  const marketStatus = useMarketStatus();
  const marketOpen = marketStatus.data?.state === 'REGULAR';

  const chartType = useChartPrefsStore((s) => s.type);
  const showVolume = useChartPrefsStore((s) => s.showVolume);
  const showTrades = useChartPrefsStore((s) => s.showTrades);
  const setChartType = useChartPrefsStore((s) => s.setType);
  const toggleVolume = useChartPrefsStore((s) => s.toggleVolume);
  const toggleTrades = useChartPrefsStore((s) => s.toggleTrades);

  const tradeHistory = useTradeHistory(gameId ?? '');
  const portfolio = usePortfolio(gameId ?? '');
  const avgCost = portfolio.data?.holdings.find((h) => h.symbol === symbol)?.avgCostBasis;
  const overlayTrades = !!gameId && showTrades;

  const bars = useMemo(() => history.data?.bars ?? EMPTY_BARS, [history.data]);
  const barSeconds = history.data?.barSeconds;

  // Tail state for the per-tick effect, reset whenever the series is rebuilt.
  const lastAppendedTimeRef = useRef<number>(0);
  const lastCandleRef = useRef<CandlestickData | null>(null);
  // Every time currently plotted, ascending — trade markers snap onto these.
  const pointTimesRef = useRef<number[]>([]);
  // Bumped when the series is rebuilt or a tick adds a new point, so the
  // marker and price-line effects re-run against the current series.
  const [seriesVersion, setSeriesVersion] = useState(0);
  const [pointsVersion, setPointsVersion] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      width: container.clientWidth,
      height: 300,
      layout: { background: { color: 'transparent' }, textColor: '#888' },
      grid: { vertLines: { color: '#2a2a2a33' }, horzLines: { color: '#2a2a2a33' } },
      // rightOffset keeps labels on markers at the newest bar (fresh fills) readable.
      timeScale: { timeVisible: true, secondsVisible: true, rightOffset: 4 },
      handleScroll: { mouseWheel: wheelZoom },
      handleScale: { mouseWheel: wheelZoom },
    });
    chartRef.current = chart;

    // The chart sits in resizable panels, so track the container, not the window.
    const observer = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth });
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
    };
    // wheelZoom only seeds the options; the effect below keeps it in sync
    // without tearing down the chart.
  }, []);

  useEffect(() => {
    chartRef.current?.applyOptions({
      handleScroll: { mouseWheel: wheelZoom },
      handleScale: { mouseWheel: wheelZoom },
    });
  }, [wheelZoom]);

  // Rebuild the main series on chart-type or history change. Declared before
  // the tick effect so a symbol switch resets the tail refs before new ticks
  // are appended.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    let main: MainSeries;
    if (chartType === 'candles') {
      const api = chart.addCandlestickSeries({
        upColor: CHART_UP_COLOR,
        downColor: CHART_DOWN_COLOR,
        wickUpColor: CHART_UP_COLOR,
        wickDownColor: CHART_DOWN_COLOR,
        borderVisible: false,
      });
      const candles = toCandles(bars);
      api.setData(candles);
      lastCandleRef.current = candles[candles.length - 1] ?? null;
      main = { kind: 'candles', api };
    } else {
      const api =
        chartType === 'area'
          ? chart.addAreaSeries({
              lineColor: CHART_UP_COLOR,
              topColor: `${CHART_UP_COLOR}55`,
              bottomColor: `${CHART_UP_COLOR}00`,
              lineWidth: 2,
            })
          : chart.addLineSeries({ color: CHART_UP_COLOR, lineWidth: 2 });
      api.setData(toLinePoints(bars));
      lastCandleRef.current = null;
      main = { kind: 'line', api };
    }
    mainRef.current = main;
    pointTimesRef.current = bars.map((b) => b.time);
    lastAppendedTimeRef.current = bars.length > 0 ? bars[bars.length - 1]!.time : 0;
    setSeriesVersion((v) => v + 1);

    return () => {
      // On unmount the chart-creation cleanup has already removed the chart.
      if (chartRef.current === chart) chart.removeSeries(main.api);
      if (mainRef.current === main) mainRef.current = null;
    };
  }, [chartType, bars]);

  // After the market closes the upstream just echoes the last regular close
  // every poll; appending those ticks produces a meaningless horizontal line
  // that keeps growing. Outside REGULAR hours we ignore live ticks entirely.
  useEffect(() => {
    const main = mainRef.current;
    if (!main || !marketOpen) return;
    let added = false;
    for (const t of ticks) {
      if (t.time <= lastAppendedTimeRef.current) continue;
      if (main.kind === 'candles') {
        const prev = lastCandleRef.current;
        // An older server sends no barSeconds; each tick then gets its own candle.
        const candle = foldTick(prev, t, barSeconds ?? 1);
        main.api.update(candle);
        if (!prev || candle.time !== prev.time) {
          pointTimesRef.current.push(candle.time as number);
          added = true;
        }
        lastCandleRef.current = candle;
      } else {
        main.api.update({ time: t.time as UTCTimestamp, value: t.price });
        pointTimesRef.current.push(t.time);
        added = true;
      }
      lastAppendedTimeRef.current = t.time;
    }
    if (added) setPointsVersion((v) => v + 1);
  }, [ticks, marketOpen, barSeconds, seriesVersion]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const data = showVolume ? toVolumeBars(bars) : [];
    // Leave room at the bottom for the volume pane only while it is drawn.
    chart.priceScale('right').applyOptions({
      scaleMargins: { top: 0.1, bottom: data.length > 0 ? 0.25 : 0.1 },
    });
    if (data.length === 0) return;
    const volume = chart.addHistogramSeries({
      priceScaleId: 'volume',
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    volume.setData(data);
    return () => {
      if (chartRef.current === chart) chart.removeSeries(volume);
    };
  }, [showVolume, bars]);

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    main.api.setMarkers(
      overlayTrades ? tradesToMarkers(tradeHistory.data ?? [], symbol, pointTimesRef.current) : [],
    );
  }, [overlayTrades, tradeHistory.data, symbol, seriesVersion, pointsVersion]);

  useEffect(() => {
    const main = mainRef.current;
    if (!main || !overlayTrades || avgCost == null) return;
    const line = main.api.createPriceLine({
      price: avgCost,
      color: '#a1a1aa',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: 'Avg cost',
    });
    return () => {
      if (mainRef.current === main) main.api.removePriceLine(line);
    };
  }, [overlayTrades, avgCost, seriesVersion]);

  // Fit the time axis once per (symbol, range) load — not on every tick, which
  // would reflow the whole chart and look jumpy.
  useEffect(() => {
    if (!history.data || history.data.bars.length === 0) return;
    chartRef.current?.timeScale().fitContent();
  }, [history.data]);

  const empty = bars.length === 0 && ticks.length === 0;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="Chart options">
        {CHART_TYPES.map((t) => (
          <Button
            key={t.key}
            size="sm"
            variant={t.key === chartType ? 'default' : 'ghost'}
            aria-pressed={t.key === chartType}
            onClick={() => setChartType(t.key)}
            className="h-7 px-2 text-xs"
          >
            {t.label}
          </Button>
        ))}
        <div className="ml-auto flex gap-1">
          <Button
            size="sm"
            variant={showVolume ? 'secondary' : 'ghost'}
            aria-pressed={showVolume}
            onClick={toggleVolume}
            className="h-7 px-2 text-xs"
          >
            Volume
          </Button>
          {gameId && (
            <Button
              size="sm"
              variant={showTrades ? 'secondary' : 'ghost'}
              aria-pressed={showTrades}
              onClick={toggleTrades}
              className="h-7 px-2 text-xs"
            >
              My trades
            </Button>
          )}
        </div>
      </div>
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
