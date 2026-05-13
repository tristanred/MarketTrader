import { useEffect } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { useWatchlists, useCreateWatchlist } from '@/api/watchlists';
import { useWatchlistUiStore } from '@/stores/watchlistUiStore';
import { WatchlistSelector } from './WatchlistSelector';
import { WatchlistView } from './WatchlistView';
import { WatchlistEditor } from './WatchlistEditor';

const DEFAULT_NAME = 'New Watchlist';

/**
 * Body of the "Watchlist" tab inside HoldingsSidebar. Owns selection and
 * edit-mode wiring; delegates rendering to WatchlistSelector + (View | Editor).
 * Auto-selects the first list once data loads, and offers a one-click empty
 * state when the user has none yet.
 */
export function WatchlistTab() {
  const watchlists = useWatchlists();
  const create = useCreateWatchlist();
  const selectedId = useWatchlistUiStore((s) => s.selectedWatchlistId);
  const setSelected = useWatchlistUiStore((s) => s.setSelected);
  const editMode = useWatchlistUiStore((s) => s.editMode);

  const lists = watchlists.data ?? [];
  const selected = lists.find((l) => l.id === selectedId) ?? lists[0] ?? null;

  // Keep the selected id in sync with the server data: pick the first list
  // on initial load, and recover if the previously selected list was deleted.
  useEffect(() => {
    if (lists.length === 0) {
      if (selectedId !== null) setSelected(null);
      return;
    }
    if (!lists.some((l) => l.id === selectedId)) {
      setSelected(lists[0]!.id);
    }
  }, [lists, selectedId, setSelected]);

  if (watchlists.isLoading) {
    return <Skeleton className="mt-3 h-32 w-full" />;
  }

  if (lists.length === 0) {
    return (
      <div className="space-y-3 py-6 text-center">
        <p className="text-xs text-muted-foreground">You don't have any watchlists yet.</p>
        <Button
          size="sm"
          disabled={create.isPending}
          onClick={() => create.mutate({ name: DEFAULT_NAME })}
        >
          Create your first watchlist
        </Button>
      </div>
    );
  }

  if (!selected) return null;

  return (
    <div className="space-y-3 pt-3">
      <WatchlistSelector watchlists={lists} selected={selected} />
      {editMode ? <WatchlistEditor watchlist={selected} /> : <WatchlistView watchlist={selected} />}
    </div>
  );
}
