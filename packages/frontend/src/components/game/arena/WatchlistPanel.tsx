import { useEffect, useState } from 'react';
import { Panel, PanelHeader, PanelBody } from '@/components/panel';
import { SymbolSearch } from '@/components/search';
import { useAddWatchlistSymbol, useCreateWatchlist } from '@/api/watchlists';
import { cn } from '@/lib/utils';

export interface WatchlistRow {
  symbol: string;
  last?: number;
  changePct?: number;
}

export interface WatchlistPanelProps {
  rows: WatchlistRow[];
  onSelect?: (symbol: string) => void;
  /**
   * The watchlist to add symbols to when the user opens the inline
   * `+ ADD` affordance. `null` when no watchlist exists yet — the button
   * renders disabled in that case.
   */
  watchlistId?: string | null;
  className?: string;
}

/**
 * Right-column compact watchlist. Each clickable row drives the arena's
 * SelectedSymbolContext. The "+ ADD" affordance expands an inline search
 * inside the panel — picking a result calls the add-symbol mutation in
 * place rather than handing off to the global cmd+k overlay (which used
 * to lose the user's intent and just open the stock page).
 */
export function WatchlistPanel({
  rows,
  onSelect,
  watchlistId = null,
  className,
}: WatchlistPanelProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const addMutation = useAddWatchlistSymbol();
  const createMutation = useCreateWatchlist();

  // Close the inline add UI on Esc anywhere in the panel.
  useEffect(() => {
    if (!addOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAddOpen(false);
        setAddError(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [addOpen]);

  // If the user has no watchlist yet, the first add auto-creates a
  // "Default" list. Avoids a dead-end UI for users without a list yet.

  return (
    <Panel className={className}>
      <PanelHeader
        right={
          addOpen ? (
            <kbd className="rounded-chip border border-hairline-strong bg-bg px-1.5 py-0.5 font-mono text-[10px] tracking-normal text-muted">
              ESC
            </kbd>
          ) : (
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="font-mono text-[10px] tracking-[0.14em] text-accent hover:underline"
            >
              + ADD
            </button>
          )
        }
      >
        {addOpen ? 'Add to watchlist' : 'Watchlist'}
      </PanelHeader>
      <PanelBody>
        {addOpen ? (
          <div className="flex flex-col gap-1.5">
            <SymbolSearch
              autoFocus
              placeholder="Search symbol to add..."
              onSelect={async (sym) => {
                setAddError(null);
                try {
                  let targetId = watchlistId;
                  if (!targetId) {
                    const created = await createMutation.mutateAsync({
                      name: 'Default',
                    });
                    targetId = created.id;
                  }
                  await addMutation.mutateAsync({
                    id: targetId,
                    body: { symbol: sym },
                  });
                  setAddOpen(false);
                } catch (err) {
                  const msg =
                    err instanceof Error ? err.message : 'Failed to add symbol';
                  setAddError(msg);
                }
              }}
            />
            {addError ? (
              <p className="px-1 font-mono text-[10px] text-loss">{addError}</p>
            ) : null}
          </div>
        ) : rows.length === 0 ? (
          <p className="py-3 text-center text-xs text-muted">Watchlist is empty.</p>
        ) : (
          <ul className="space-y-0.5">
            {rows.map((r) => (
              <li key={r.symbol}>
                <button
                  type="button"
                  onClick={onSelect ? () => onSelect(r.symbol) : undefined}
                  disabled={!onSelect}
                  className={cn(
                    'grid w-full grid-cols-[1fr_auto_auto] items-baseline gap-2 py-1 text-xs',
                    onSelect && 'cursor-pointer hover:bg-hairline',
                    !onSelect && 'cursor-default',
                  )}
                >
                  <span className="font-mono text-accent text-left">{r.symbol}</span>
                  <span className="font-mono text-text">{r.last !== undefined ? fmt(r.last) : '—'}</span>
                  <span
                    className={cn(
                      'font-mono',
                      r.changePct === undefined && 'text-muted',
                      r.changePct !== undefined && r.changePct >= 0 && 'text-gain',
                      r.changePct !== undefined && r.changePct < 0 && 'text-loss',
                    )}
                  >
                    {r.changePct === undefined ? '—' : fmtPct(r.changePct)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PanelBody>
    </Panel>
  );
}

function fmt(n: number): string {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}
function fmtPct(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${Math.abs(n).toFixed(2)}%`;
}
