import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useStockSearch, useStockQuote } from '@/api/stocks';
import { useLiveStore } from '@/stores/liveStore';
import { useQuoteDialogStore } from '@/stores/quoteDialogStore';
import { ApiError } from '@/lib/api';
import { cn, formatPct } from '@/lib/utils';
import type { StockSearchResult } from '@markettrader/shared';

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return v;
}

/**
 * Top-of-page symbol search card. Every trade flows through
 * {@link QuoteInfoDialog} → {@link TradeOrderDialog}.
 */
export function SymbolSearchCard() {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query.trim(), 250);
  const search = useStockSearch(debouncedQuery);
  const showDropdown = debouncedQuery.length >= 1;

  const apiError = search.error instanceof ApiError ? search.error : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="uppercase tracking-wide text-xs text-muted-foreground">
          Symbol Search / Trade
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
            aria-hidden
          />
          <Input
            id="symbol-search"
            placeholder="Enter Company or Symbol"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            className="pl-9 pr-9"
            aria-label="Symbol search"
          />
          {query.length > 0 && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {showDropdown && (
          <div className="mt-2 rounded-md border bg-background">
            {search.isLoading ? (
              <div className="space-y-2 p-3">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : apiError ? (
              <p className="p-3 text-sm text-destructive">
                {apiError.status === 429
                  ? 'Market data rate-limited. Try again in a minute.'
                  : 'Search failed. Try again.'}
              </p>
            ) : !search.data || search.data.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">No matches.</p>
            ) : (
              <>
                <p className="border-b px-3 py-2 text-xs text-muted-foreground">
                  Displaying {search.data.length} result{search.data.length === 1 ? '' : 's'}
                </p>
                <ul role="listbox">
                  {search.data.map((r) => (
                    <SearchResultRow key={r.symbol} result={r} />
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SearchResultRow({ result }: { result: StockSearchResult }) {
  const quote = useStockQuote(result.symbol);
  const liveQuote = useLiveStore((s) => s.pricesBySymbol[result.symbol]);
  const openQuote = useQuoteDialogStore((s) => s.openQuote);

  const price = liveQuote?.price ?? quote.data?.price;
  const change = liveQuote?.change ?? quote.data?.change;
  const changePercent = liveQuote?.changePercent ?? quote.data?.changePercent;
  const positive = (change ?? 0) >= 0;

  return (
    <li className="flex items-center gap-3 border-b px-3 py-2 last:border-b-0">
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => openQuote(result.symbol)}
          className="font-medium hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {result.symbol}
        </button>
        <p className="truncate text-xs text-muted-foreground">{result.name}</p>
      </div>
      <div className="text-right text-sm tabular-nums">
        <div>{price !== undefined ? price.toFixed(2) : '—'}</div>
        {change !== undefined && changePercent !== undefined && (
          <div className={cn('text-xs', positive ? 'text-green-600' : 'text-destructive')}>
            {(positive ? '+' : '') + change.toFixed(2)} {formatPct(changePercent)}
          </div>
        )}
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => openQuote(result.symbol)}
        aria-label={`Open ${result.symbol} trade dialog`}
      >
        Trade
      </Button>
    </li>
  );
}
