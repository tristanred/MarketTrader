import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useStockDetails, useStockSearch } from '@/api/stocks';
import { useMarketStatus } from '@/api/market-status';
import { useLiveStore } from '@/stores/liveStore';
import { usePortfolio } from '@/api/trades';
import { ChartCanvas, RANGES } from '@/components/StockChart';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { cn, formatCompactNumber, formatPct, formatUSD } from '@/lib/utils';
import type { StockHistoryRange } from '@markettrader/shared';

export interface QuoteInfoProps {
  symbol: string;
  variant: 'compact' | 'full';
  /** When provided, the dialog renders a "Your position" card sourced from the game's portfolio. */
  gameId?: string;
  onSymbolChange?: (symbol: string) => void;
  onTradeClick?: (symbol: string) => void;
  showSearch?: boolean;
  showTradeButton?: boolean;
}

/**
 * Quote-info content shared by {@link QuoteInfoDialog} (modal) and SymbolPage
 * (standalone route). Pure presentation + data-fetching; opening/closing the
 * modal and reacting to "Trade" is left to the wrappers.
 */
export function QuoteInfo({
  symbol,
  variant,
  gameId,
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
  const portfolio = usePortfolio(gameId ?? '');

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
      hour: 'numeric',
      minute: '2-digit',
    });
  }, [data?.fetchedAt]);

  const holding = useMemo(() => {
    if (!gameId || !portfolio.data) return undefined;
    return portfolio.data.holdings.find((h) => h.symbol === symbol);
  }, [gameId, portfolio.data, symbol]);

  const handlePick = (next: string) => {
    setSearchQuery('');
    setShowSuggestions(false);
    onSymbolChange?.(next);
  };

  return (
    <div className={cn('space-y-5', variant === 'full' && 'mx-auto max-w-3xl py-6')}>
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
                    className="flex w-full items-baseline px-3 py-2 text-left text-sm hover:bg-accent"
                    onClick={() => handlePick(r.symbol)}
                  >
                    <span className="font-medium">{r.symbol}</span>
                    <span className="ml-2 text-muted-foreground">{r.name}</span>
                    <span
                      className={cn(
                        'ml-auto pl-2 font-mono',
                        r.changePercent === undefined && 'text-muted-foreground',
                        r.changePercent !== undefined && r.changePercent >= 0 && 'text-gain',
                        r.changePercent !== undefined && r.changePercent < 0 && 'text-loss',
                      )}
                    >
                      {r.changePercent === undefined ? '—' : formatPct(r.changePercent)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Meta row: exchange chip + name (left) · live state + timestamp (right) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-bg px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-accent">
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                marketOpen ? 'bg-gain animate-pulse-dot' : 'bg-muted',
              )}
            />
            {data?.exchange ?? '—'} · {symbol}
          </span>
          <span className="text-[10px] uppercase tracking-[0.14em] text-muted">
            {data?.companyName ?? symbol}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-muted">
          <span>Last updated {lastUpdatedLabel}</span>
          {data?.stale && <span className="text-loss">· Delayed</span>}
        </div>
      </div>

      {/* Hero price */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-mono text-[44px] font-bold leading-none tracking-tight tabular-nums">
            {displayPrice !== undefined ? formatUSD(displayPrice) : '—'}
          </div>
          {data && (
            <div
              className={cn(
                'mt-2 font-mono text-sm font-semibold tabular-nums',
                priceUp ? 'text-gain' : 'text-loss',
              )}
            >
              <span aria-hidden>{priceUp ? '▲' : '▼'}</span>{' '}
              {change >= 0 ? '+' : ''}
              {change.toFixed(2)} {formatPct(changePercent)}{' '}
              <span className="font-normal text-muted">today</span>
            </div>
          )}
        </div>
        {data?.previousClose !== undefined && (
          <div className="rounded-md border border-hairline-strong bg-panel px-4 py-2.5">
            <div className="text-[10px] uppercase tracking-[0.14em] text-muted">Previous close</div>
            <div className="mt-0.5 font-mono text-lg font-semibold tabular-nums">
              {formatUSD(data.previousClose)}
            </div>
          </div>
        )}
      </div>

      {/* Range selector + chart */}
      <div className="space-y-2">
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
      </div>

      {holding && <PositionCard holding={holding} />}

      <VolumeBar day={data?.dayVolume} avg={data?.avgVolume} />

      {details.isError && (
        <p className="text-xs text-loss">Could not load quote details.</p>
      )}

      {showTradeButton && onTradeClick && (
        <div className="flex justify-end border-t border-hairline-strong pt-4">
          <Button
            onClick={() => onTradeClick(symbol)}
            className="px-6 uppercase tracking-wider"
          >
            Trade {symbol} →
          </Button>
        </div>
      )}
    </div>
  );
}

interface HoldingForCard {
  quantity: number;
  avgCostBasis: number;
  marketValue: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
}

function PositionCard({ holding }: { holding: HoldingForCard }) {
  const gain = holding.unrealizedPnL >= 0;
  return (
    <div className="rounded-md border border-hairline-strong bg-panel p-4">
      <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
        Your position
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Stat label="Shares" value={String(holding.quantity)} />
        <Stat label="Avg cost" value={formatUSD(holding.avgCostBasis)} />
        <Stat
          label="Unrealized"
          value={
            <span className={gain ? 'text-gain' : 'text-loss'}>
              {gain ? '+' : ''}
              {formatUSD(holding.unrealizedPnL)}{' '}
              <span className="text-muted">
                ({gain ? '+' : ''}
                {holding.unrealizedPnLPercent.toFixed(2)}%)
              </span>
            </span>
          }
        />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted">{label}</div>
      <div className="mt-1 font-mono text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function VolumeBar({ day, avg }: { day: number | undefined; avg: number | undefined }) {
  if (day === undefined) return null;
  const max = Math.max(day, avg ?? day);
  const pct = max > 0 ? (day / max) * 100 : 0;
  const ratio = avg !== undefined && avg > 0 ? Math.round((day / avg) * 100) : null;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-[10px] uppercase tracking-[0.14em] text-muted">
        <span>Volume {formatCompactNumber(day)}</span>
        {avg !== undefined && <span>65d avg {formatCompactNumber(avg)}</span>}
      </div>
      <div className="h-1.5 rounded bg-hairline-strong">
        <div className="h-full rounded bg-accent" style={{ width: `${pct}%` }} />
      </div>
      {ratio !== null && (
        <p className="text-[10px] uppercase tracking-[0.14em] text-accent">
          {ratio}% vs avg
        </p>
      )}
    </div>
  );
}
