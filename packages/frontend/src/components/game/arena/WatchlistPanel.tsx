import { memo, useEffect, useRef, useState } from 'react';
import { Panel, PanelHeader, PanelBody } from '@/components/panel';
import { SymbolSearch } from '@/components/search';
import {
  useAddWatchlistSymbol,
  useCreateWatchlist,
  useDeleteWatchlist,
  useRenameWatchlist,
} from '@/api/watchlists';
import { useLiveStore } from '@/stores/liveStore';
import { cn } from '@/lib/utils';
import type { Watchlist } from '@markettrader/shared';

export interface WatchlistRow {
  symbol: string;
  /** Optional last-known price; live ticks override per-row. */
  last?: number;
  /** Optional last-known change percent; live ticks override per-row. */
  changePct?: number;
}

export interface WatchlistPanelProps {
  rows: WatchlistRow[];
  onSelect?: (symbol: string) => void;
  /**
   * The watchlist the panel is currently showing. `null` when none
   * exists; the first add auto-creates a "Default" list.
   */
  watchlistId?: string | null;
  /** All of the user's watchlists, for the header dropdown. */
  lists?: Watchlist[];
  /** Called when the user picks a different list from the dropdown. */
  onSelectList?: (id: string) => void;
  className?: string;
}

type Mode = 'idle' | 'add' | 'create';

/**
 * Right-column compact watchlist. The header doubles as a dropdown
 * trigger so users can switch between their lists or create a new one.
 * `+ ADD` expands inline to add symbols to the active list. Picking a
 * symbol calls the add-symbol mutation in place — we never hand off to
 * the global cmd+k overlay (which would just navigate the user away).
 */
export function WatchlistPanel({
  rows,
  onSelect,
  watchlistId = null,
  lists = [],
  onSelectList,
  className,
}: WatchlistPanelProps) {
  const [mode, setMode] = useState<Mode>('idle');
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const addMutation = useAddWatchlistSymbol();
  const createMutation = useCreateWatchlist();
  const renameMutation = useRenameWatchlist();
  const deleteMutation = useDeleteWatchlist();
  const menuRef = useRef<HTMLDivElement>(null);

  // Combined global listeners: Esc collapses any open inline mode and closes
  // the switcher dropdown; outside-click closes the switcher dropdown. Each
  // listener early-returns when nothing's open, so they stay attached for the
  // panel's lifetime without doing real work when idle.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (mode === 'idle' && !menuOpen) return;
      setMode('idle');
      setMenuOpen(false);
      setError(null);
      setNewName('');
    };
    const onDown = (e: MouseEvent) => {
      if (!menuOpen) return;
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [mode, menuOpen]);

  // Reset in-menu rename/delete UI when the menu is closed.
  useEffect(() => {
    if (!menuOpen) {
      setRenamingId(null);
      setRenameDraft('');
      setConfirmDeleteId(null);
    }
  }, [menuOpen]);

  const activeList = lists.find((l) => l.id === watchlistId) ?? null;
  const activeLabel = activeList ? activeList.name : 'No list';

  const submitCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setError(null);
    try {
      const created = await createMutation.mutateAsync({ name });
      onSelectList?.(created.id);
      setMode('idle');
      setNewName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create list');
    }
  };

  const submitRename = async (id: string) => {
    const name = renameDraft.trim();
    if (!name) {
      setRenamingId(null);
      return;
    }
    setError(null);
    try {
      await renameMutation.mutateAsync({ id, body: { name } });
      setRenamingId(null);
      setRenameDraft('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename list');
    }
  };

  const submitDelete = async (id: string) => {
    setError(null);
    try {
      await deleteMutation.mutateAsync(id);
      setConfirmDeleteId(null);
      // If the deleted list was the active one, fall back to the first
      // remaining list (if any). The query invalidation will repopulate
      // `lists` on next render.
      if (watchlistId === id) {
        const next = lists.find((l) => l.id !== id);
        if (next) onSelectList?.(next.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete list');
    }
  };

  const headerLabel = (() => {
    if (mode === 'add') return 'Add to watchlist';
    if (mode === 'create') return 'New watchlist';
    return `Watchlist · ${activeLabel}`;
  })();

  const listSwitcher = (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted hover:text-text-strong"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <span aria-hidden>▾</span>
        <span>{activeLabel}</span>
      </button>
      {menuOpen ? (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-1 min-w-[220px] overflow-hidden rounded-chip border border-hairline-strong bg-panel"
        >
          <ul>
            {lists.map((l) => {
              const isActive = l.id === watchlistId;
              const isRenaming = renamingId === l.id;
              const isConfirmingDelete = confirmDeleteId === l.id;
              return (
                <li key={l.id} className="group">
                  {isRenaming ? (
                    <div className="flex items-center gap-1 px-2 py-1">
                      <input
                        autoFocus
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void submitRename(l.id);
                          } else if (e.key === 'Escape') {
                            setRenamingId(null);
                            setRenameDraft('');
                          }
                        }}
                        maxLength={64}
                        className="h-6 flex-1 rounded-chip border border-hairline-strong bg-bg px-1.5 font-mono text-xs text-text focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                      <button
                        type="button"
                        aria-label="Save rename"
                        onClick={() => void submitRename(l.id)}
                        className="px-1.5 font-mono text-xs text-accent hover:text-text-strong"
                      >
                        ✓
                      </button>
                      <button
                        type="button"
                        aria-label="Cancel rename"
                        onClick={() => {
                          setRenamingId(null);
                          setRenameDraft('');
                        }}
                        className="px-1.5 font-mono text-xs text-muted hover:text-text"
                      >
                        ✕
                      </button>
                    </div>
                  ) : isConfirmingDelete ? (
                    <div className="flex items-center justify-between gap-2 px-3 py-1.5 font-mono text-xs">
                      <span className="text-loss">Delete &ldquo;{l.name}&rdquo;?</span>
                      <span className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void submitDelete(l.id)}
                          className="font-mono text-[10px] uppercase tracking-[0.14em] text-loss hover:underline"
                        >
                          Yes
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted hover:text-text"
                        >
                          No
                        </button>
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center hover:bg-hairline">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          onSelectList?.(l.id);
                          setMenuOpen(false);
                        }}
                        className="flex flex-1 items-center gap-2 px-3 py-1.5 text-left font-mono text-xs text-text"
                      >
                        <span aria-hidden className={isActive ? 'text-accent' : 'text-muted'}>
                          {isActive ? '•' : ' '}
                        </span>
                        {l.name}
                      </button>
                      <button
                        type="button"
                        aria-label={`Rename ${l.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenamingId(l.id);
                          setRenameDraft(l.name);
                          setConfirmDeleteId(null);
                        }}
                        className="px-2 py-1.5 text-muted opacity-0 hover:text-text-strong group-hover:opacity-100 focus-visible:opacity-100"
                      >
                        <PencilIcon />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${l.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(l.id);
                          setRenamingId(null);
                        }}
                        className="px-2 py-1.5 text-muted opacity-0 hover:text-loss group-hover:opacity-100 focus-visible:opacity-100"
                      >
                        <XIcon />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
            {lists.length === 0 ? (
              <li className="px-3 py-1.5 font-mono text-xs text-muted">No lists yet.</li>
            ) : null}
            <li className="border-t border-hairline-strong">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  setMode('create');
                }}
                className="flex w-full items-center px-3 py-1.5 text-left font-mono text-xs uppercase tracking-[0.14em] text-accent hover:bg-hairline"
              >
                + New list
              </button>
            </li>
          </ul>
          {error ? (
            <p className="border-t border-hairline-strong px-3 py-1 font-mono text-[10px] text-loss">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  const headerRight =
    mode === 'idle' ? (
      <button
        type="button"
        onClick={() => setMode('add')}
        className="font-mono text-[10px] tracking-[0.14em] text-accent hover:underline"
      >
        + ADD
      </button>
    ) : (
      <kbd className="rounded-chip border border-hairline-strong bg-bg px-1.5 py-0.5 font-mono text-[10px] tracking-normal text-muted">
        ESC
      </kbd>
    );

  return (
    <Panel className={className}>
      <PanelHeader right={headerRight}>{headerLabel}</PanelHeader>
      <PanelBody>
        {mode === 'idle' ? (
          <div className="mb-1.5 flex items-center justify-between border-b border-hairline pb-1.5">
            {listSwitcher}
          </div>
        ) : null}
        {mode === 'add' ? (
          <div className="flex flex-col gap-1.5">
            <SymbolSearch
              autoFocus
              placeholder="Search symbol to add..."
              onSelect={async (sym) => {
                setError(null);
                try {
                  let targetId = watchlistId;
                  if (!targetId) {
                    const created = await createMutation.mutateAsync({
                      name: 'Default',
                    });
                    targetId = created.id;
                    onSelectList?.(created.id);
                  }
                  await addMutation.mutateAsync({
                    id: targetId,
                    body: { symbol: sym },
                  });
                  setMode('idle');
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Failed to add symbol');
                }
              }}
            />
            {error ? <p className="px-1 font-mono text-[10px] text-loss">{error}</p> : null}
          </div>
        ) : mode === 'create' ? (
          <div className="flex flex-col gap-1.5">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void submitCreate();
                }
              }}
              placeholder="Name..."
              className="h-8 w-full rounded-chip border border-hairline-strong bg-panel px-2 font-mono text-xs text-text placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent"
              maxLength={64}
            />
            <div className="flex items-center justify-between">
              <p className="px-1 font-mono text-[10px] text-muted">Enter to create</p>
              {error ? <p className="px-1 font-mono text-[10px] text-loss">{error}</p> : null}
            </div>
          </div>
        ) : rows.length === 0 ? (
          <p className="py-3 text-center text-xs text-muted">Watchlist is empty.</p>
        ) : (
          <ul className="space-y-0.5">
            {rows.map((r) => (
              <WatchRowItem
                key={r.symbol}
                row={r}
                {...(onSelect ? { onSelect } : {})}
              />
            ))}
          </ul>
        )}
      </PanelBody>
    </Panel>
  );
}

const WatchRowItem = memo(function WatchRowItem({
  row,
  onSelect,
}: {
  row: WatchlistRow;
  onSelect?: (symbol: string) => void;
}) {
  // Live ticks for this specific symbol — primitives so Object.is equality
  // means siblings don't re-render when another row's price moves.
  const livePrice = useLiveStore((s) => s.pricesBySymbol[row.symbol]?.price);
  const liveChangePct = useLiveStore((s) => s.pricesBySymbol[row.symbol]?.changePercent);
  const last = livePrice ?? row.last;
  const changePct = liveChangePct ?? row.changePct;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect ? () => onSelect(row.symbol) : undefined}
        disabled={!onSelect}
        className={cn(
          'grid w-full grid-cols-[1fr_auto_auto] items-baseline gap-2 py-1 text-xs',
          onSelect && 'cursor-pointer hover:bg-hairline',
          !onSelect && 'cursor-default',
        )}
      >
        <span className="font-mono text-accent text-left">{row.symbol}</span>
        <span className="font-mono text-text">{last !== undefined ? fmt(last) : '—'}</span>
        <span
          className={cn(
            'font-mono',
            changePct === undefined && 'text-muted',
            changePct !== undefined && changePct >= 0 && 'text-gain',
            changePct !== undefined && changePct < 0 && 'text-loss',
          )}
        >
          {changePct === undefined ? '—' : fmtPct(changePct)}
        </span>
      </button>
    </li>
  );
});

function PencilIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 12 12"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="square"
      strokeLinejoin="miter"
    >
      <path d="M8.5 1.5 L10.5 3.5 L4 10 L1.5 10.5 L2 8 Z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 12 12"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="square"
    >
      <path d="M2 2 L10 10 M10 2 L2 10" />
    </svg>
  );
}

function fmt(n: number): string {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}
function fmtPct(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${Math.abs(n).toFixed(2)}%`;
}
