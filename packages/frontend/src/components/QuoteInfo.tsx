import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useStockDetails, useStockSearch } from '@/api/stocks';
import { useMarketStatus } from '@/api/market-status';
import { useLiveStore } from '@/stores/liveStore';
import { ChartCanvas, RANGES } from '@/components/StockChart';
import { cn, formatCompactNumber, formatPct, formatUSD } from '@/lib/utils';
import type { StockHistoryRange } from '@markettrader/shared';

export interface QuoteInfoProps {
  symbol: string;
  variant: 'compact' | 'full';
  onSymbolChange?: (symbol: string) => void;
  onTradeClick?: (symbol: string) => void;
  showSearch?: boolean;
  showTradeButton?: boolean;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return v;
}

/**
 * Quote-info content shared by {@link QuoteInfoDialog} (modal) and SymbolPage
 * (standalone route). Pure presentation + data-fetching; opening/closing the
 * modal and reacting to "Trade" is left to the wrappers.
 */
export function QuoteInfo({
  symbol,
  variant,
  onSymbolChange,
  onTradeClick,
  showSearch = true,
  showTradeButton = true,
}: QuoteInfoProps) {
  const [range, setRange] = useState<StockHistoryRange>('1d');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debouncedQuery = useDebouncedValue(searchQuery, 250);

  const details = useStockDetails(symbol);
  const search = useStockSearch(debouncedQuery);
  const livePrice = useLiveStore((s) => s.pricesBySymbol[symbol]?.price);
  const marketStatus = useMarketStatus();

  const data = details.data;
  const displayPrice = livePrice ?? data?.price;
  const change = data?.change ?? 0;
  const changePercent = data?.changePercent ?? 0;
  const priceUp = change >= 0;

  const marketOpen = marketStatus.data?.state === 'REGULAR';
  const lastUpdatedLabel = useMemo(() => {
    if (!data?.fetchedAt) return '—';
    return new Date(data.fetchedAt).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }, [data?.fetchedAt]);

  const handlePick = (next: string) => {
    setSearchQuery('');
    setShowSuggestions(false);
    onSymbolChange?.(next);
  };

  return (
    <div className={cn('space-y-4', variant === 'full' && 'mx-auto max-w-3xl py-6')}>
      {showSearch && onSymbolChange && (
        <div className="relative">
          <Input
            placeholder="Enter Company or Symbol"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            autoComplete="off"
          />
          {showSuggestions && search.data && search.data.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-44 w-full overflow-auto rounded-md border bg-background shadow-md">
              {search.data.slice(0, 8).map((r) => (
                <li key={r.symbol}>
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left text-sm hover:bg-accent"
                    onClick={() => handlePick(r.symbol)}
                  >
                    <span className="font-medium">{r.symbol}</span>
                    <span className="ml-2 text-muted-foreground">{r.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded bg-primary px-2 py-0.5 text-xs font-semibold uppercase text-primary-foreground">
            {data?.exchange ?? '—'}
          </span>
          <h2 className="text-xl font-semibold">{data?.companyName ?? symbol}</h2>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold',
              marketOpen
                ? 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300'
                : 'bg-muted text-muted-foreground',
            )}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                marketOpen ? 'bg-green-500' : 'bg-muted-foreground',
              )}
            />
            {marketOpen ? 'OPEN' : 'CLOSED'}
          </span>
          <span>Last Updated: {lastUpdatedLabel}</span>
          {data?.stale && <span className="text-yellow-700 dark:text-yellow-400">· Delayed quote</span>}
        </div>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-4xl font-bold tabular-nums">
            {displayPrice !== undefined ? formatUSD(displayPrice) : '—'}
          </div>
          {data && (
            <div
              className={cn(
                'mt-1 text-sm font-semibold tabular-nums',
                priceUp ? 'text-green-600 dark:text-green-400' : 'text-destructive',
              )}
            >
              <span aria-hidden>{priceUp ? '▲' : '▼'}</span>{' '}
              {change >= 0 ? '+' : ''}
              {change.toFixed(2)} {formatPct(changePercent)}
            </div>
          )}
        </div>
        {data?.previousClose !== undefined && (
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <div className="text-xs text-muted-foreground">Previous Close</div>
            <div className="font-semibold tabular-nums">{formatUSD(data.previousClose)}</div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1">
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

      <ChartCanvas symbol={symbol} range={range} />

      <VolumeBar day={data?.dayVolume} avg={data?.avgVolume} />

      {details.isError && (
        <p className="text-xs text-destructive">Could not load quote details.</p>
      )}

      {showTradeButton && onTradeClick && (
        <div className="flex justify-end border-t pt-3">
          <Button onClick={() => onTradeClick(symbol)}>Trade {symbol}</Button>
        </div>
      )}
    </div>
  );
}

function VolumeBar({ day, avg }: { day: number | undefined; avg: number | undefined }) {
  if (day === undefined) return null;
  const max = Math.max(day, avg ?? day);
  const pct = max > 0 ? (day / max) * 100 : 0;
  const ratio = avg !== undefined && avg > 0 ? Math.round((day / avg) * 100) : null;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>VOLUME: {formatCompactNumber(day)}</span>
        {avg !== undefined && <span>65 Day Avg: {formatCompactNumber(avg)}</span>}
      </div>
      <div className="h-2 rounded bg-muted">
        <div className="h-full rounded bg-primary" style={{ width: `${pct}%` }} />
      </div>
      {ratio !== null && (
        <p className="text-xs text-muted-foreground">{ratio}% VS AVG</p>
      )}
    </div>
  );
}
