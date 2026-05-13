import { WatchlistRow } from './WatchlistRow';
import { useWatchlistUiStore } from '@/stores/watchlistUiStore';
import { Button } from '@/components/ui/button';
import type { Watchlist } from '@markettrader/shared';

interface Props {
  watchlist: Watchlist;
}

/**
 * Read-only watchlist body shown when not in edit mode. Renders the symbol
 * table; empty state nudges the user into edit mode to add the first symbol.
 */
export function WatchlistView({ watchlist }: Props) {
  const setEditMode = useWatchlistUiStore((s) => s.setEditMode);

  if (watchlist.symbols.length === 0) {
    return (
      <div className="space-y-3 py-6 text-center">
        <p className="text-xs text-muted-foreground">No symbols on this watchlist yet.</p>
        <Button size="sm" variant="outline" onClick={() => setEditMode(true)}>
          Add symbols
        </Button>
      </div>
    );
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b text-muted-foreground">
          <th className="py-1.5 text-left font-normal">Symbol</th>
          <th className="py-1.5 text-right font-normal">Price/Vol</th>
          <th className="py-1.5 text-right font-normal">% Chg</th>
        </tr>
      </thead>
      <tbody>
        {watchlist.symbols.map((symbol) => (
          <WatchlistRow key={symbol} symbol={symbol} />
        ))}
      </tbody>
    </table>
  );
}
