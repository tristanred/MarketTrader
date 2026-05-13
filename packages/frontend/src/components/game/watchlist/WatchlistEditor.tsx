import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { useStockSearch } from '@/api/stocks';
import { useAddWatchlistSymbol, useRemoveWatchlistSymbol } from '@/api/watchlists';
import { toast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api';
import { WatchlistRow } from './WatchlistRow';
import type { Watchlist } from '@markettrader/shared';

interface Props {
  watchlist: Watchlist;
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
 * Edit-mode body. Shows a search box with an autocomplete dropdown of symbol
 * matches: each match has a `+` (add) or `✓` (already on the list) affordance.
 * Below the search, the current symbols list is shown with a small `×` to
 * remove each row.
 */
export function WatchlistEditor({ watchlist }: Props) {
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query.trim(), 200);
  const search = useStockSearch(debounced);
  const addItem = useAddWatchlistSymbol();
  const removeItem = useRemoveWatchlistSymbol();

  const onList = useMemo(() => new Set(watchlist.symbols), [watchlist.symbols]);

  async function add(symbol: string) {
    try {
      await addItem.mutateAsync({ id: watchlist.id, body: { symbol } });
    } catch (err) {
      const description = err instanceof ApiError ? String(err.message) : null;
      toast({
        title: 'Could not add symbol',
        ...(description !== null ? { description } : {}),
        variant: 'destructive',
      });
    }
  }

  async function remove(symbol: string) {
    try {
      await removeItem.mutateAsync({ id: watchlist.id, symbol });
    } catch {
      toast({ title: 'Could not remove symbol', variant: 'destructive' });
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Input
          autoFocus
          placeholder="Search a ticker (e.g. AAPL)"
          value={query}
          onChange={(e) => setQuery(e.target.value.toUpperCase())}
          autoComplete="off"
          className="h-9 text-xs"
        />
        {debounced.length > 0 && search.data && search.data.length > 0 && (
          <ul className="max-h-56 overflow-auto rounded-md border bg-background">
            {search.data.slice(0, 8).map((r) => {
              const already = onList.has(r.symbol);
              return (
                <li key={r.symbol}>
                  <button
                    type="button"
                    disabled={already || addItem.isPending}
                    onClick={() => add(r.symbol)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-60"
                  >
                    <span className="w-4 text-center font-semibold">
                      {already ? '✓' : '+'}
                    </span>
                    <span className="font-medium">{r.symbol}</span>
                    <span className="truncate text-muted-foreground">({r.name})</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {watchlist.symbols.length > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th className="py-1.5 text-left font-normal">Symbol</th>
              <th className="py-1.5 text-right font-normal">Price/Vol</th>
              <th className="py-1.5 text-right font-normal">% Chg</th>
              <th className="py-1.5 pl-1 text-right font-normal sr-only">Remove</th>
            </tr>
          </thead>
          <tbody>
            {watchlist.symbols.map((symbol) => (
              <WatchlistRow
                key={symbol}
                symbol={symbol}
                removable
                onRemove={() => remove(symbol)}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
