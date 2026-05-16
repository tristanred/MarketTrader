import { Panel, PanelHeader, PanelBody } from '@/components/panel';
import { cn } from '@/lib/utils';

export interface WatchlistRow {
  symbol: string;
  last?: number;
  changePct?: number;
}

export interface WatchlistPanelProps {
  rows: WatchlistRow[];
  onSelect?: (symbol: string) => void;
  className?: string;
}

/**
 * Right-column compact watchlist. Each clickable row drives the arena's
 * SelectedSymbolContext (wired by phase 3c). The "+ ADD" action lives in
 * the panel header and is reserved for phase 3c.
 */
export function WatchlistPanel({ rows, onSelect, className }: WatchlistPanelProps) {
  return (
    <Panel className={className}>
      <PanelHeader>Watchlist</PanelHeader>
      <PanelBody>
        {rows.length === 0 ? (
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
