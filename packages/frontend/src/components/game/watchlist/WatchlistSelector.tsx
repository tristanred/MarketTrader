import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api';
import {
  useCreateWatchlist,
  useDeleteWatchlist,
  useRenameWatchlist,
} from '@/api/watchlists';
import { useWatchlistUiStore } from '@/stores/watchlistUiStore';
import type { Watchlist } from '@markettrader/shared';

interface Props {
  watchlists: Watchlist[];
  selected: Watchlist;
}

const DEFAULT_NEW_NAME = 'New Watchlist';

/**
 * Header strip above the watchlist body: shows MY WATCHLIST + dropdown + pencil + plus.
 * The pencil toggles WatchlistTab's edit mode. The plus creates a new list with a
 * unique default name and selects it. Renaming the current list happens inline
 * while in edit mode (separate from this strip).
 */
export function WatchlistSelector({ watchlists, selected }: Props) {
  const setSelected = useWatchlistUiStore((s) => s.setSelected);
  const editMode = useWatchlistUiStore((s) => s.editMode);
  const setEditMode = useWatchlistUiStore((s) => s.setEditMode);

  const create = useCreateWatchlist();
  const rename = useRenameWatchlist();
  const remove = useDeleteWatchlist();
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(selected.name);

  function uniqueDefault(): string {
    const existing = new Set(watchlists.map((w) => w.name));
    if (!existing.has(DEFAULT_NEW_NAME)) return DEFAULT_NEW_NAME;
    let i = 2;
    while (existing.has(`${DEFAULT_NEW_NAME} ${i}`)) i++;
    return `${DEFAULT_NEW_NAME} ${i}`;
  }

  async function handleCreate() {
    try {
      const created = await create.mutateAsync({ name: uniqueDefault() });
      setSelected(created.id);
      setEditMode(true);
    } catch (err) {
      toast({
        title: 'Could not create watchlist',
        description: err instanceof ApiError ? String(err.message) : 'Try again later.',
        variant: 'destructive',
      });
    }
  }

  async function submitRename() {
    const name = draftName.trim();
    if (!name || name === selected.name) {
      setRenaming(false);
      setDraftName(selected.name);
      return;
    }
    try {
      await rename.mutateAsync({ id: selected.id, body: { name } });
      setRenaming(false);
    } catch (err) {
      const msg = err instanceof ApiError && err.status === 409
        ? 'A watchlist with that name already exists.'
        : 'Could not rename watchlist.';
      toast({ title: msg, variant: 'destructive' });
    }
  }

  async function handleDelete() {
    if (watchlists.length <= 1) {
      toast({ title: 'Cannot delete your last watchlist.', variant: 'destructive' });
      return;
    }
    if (!window.confirm(`Delete "${selected.name}"? This can't be undone.`)) return;
    try {
      await remove.mutateAsync(selected.id);
      setEditMode(false);
    } catch {
      toast({ title: 'Could not delete watchlist.', variant: 'destructive' });
    }
  }

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide">My Watchlist</div>
      <div className="flex items-center justify-between gap-2">
        {renaming ? (
          <Input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={submitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitRename();
              if (e.key === 'Escape') {
                setRenaming(false);
                setDraftName(selected.name);
              }
            }}
            className="h-8 flex-1 text-xs"
          />
        ) : (
          <select
            value={selected.id}
            onChange={(e) => setSelected(e.target.value)}
            className="h-8 flex-1 rounded-md border bg-background px-2 text-xs uppercase tracking-wide"
          >
            {watchlists.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        )}

        <div className="flex items-center gap-1">
          {editMode ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2"
                title="Rename"
                onClick={() => {
                  setDraftName(selected.name);
                  setRenaming((r) => !r);
                }}
                aria-label="Rename watchlist"
              >
                ✎
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-destructive"
                title="Delete"
                onClick={handleDelete}
                aria-label="Delete watchlist"
              >
                🗑
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => {
                  setRenaming(false);
                  setEditMode(false);
                }}
              >
                Done
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2"
                title="Edit watchlist"
                onClick={() => setEditMode(true)}
                aria-label="Edit watchlist"
              >
                ✎
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2"
                title="New watchlist"
                onClick={handleCreate}
                disabled={create.isPending}
                aria-label="New watchlist"
              >
                +
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
